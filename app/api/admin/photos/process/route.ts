import {NextResponse} from 'next/server';
import {authorized,sameOrigin,serverDb} from '../../../../../lib/db';

const allowedLicense=/^(CC0(?: 1\.0)?|CC BY(?:-SA)? (?:3\.0|4\.0)|Public domain(?: mark 1\.0)?)$/i;
const ignoredWords=new Set(['de','del','la','le','the','and','for','of']);
const concentrationAliases:Record<string,string[]>={
 'eau de parfum':['eau de parfum','edp'],
 'eau de toilette':['eau de toilette','edt'],
 'eau de cologne':['eau de cologne','edc'],
 'parfum':['parfum','extrait','pure perfume']
};

type Fragrance={brand:string;name:string;concentration:string};
type PhotoJob={id:number;fragrance_id:number;attempts:number;status:string;fragrances:Fragrance|null};
type CommonsPage={title?:string;imageinfo?:Array<{url?:string;thumburl?:string;descriptionurl?:string;extmetadata?:Record<string,{value?:string}>}>};

function normalize(value:string){
 return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}

function requiredWords(value:string){
 return normalize(value).split(/\s+/).filter(word=>(word.length>1||/\d/.test(word))&&!ignoredWords.has(word));
}

function concentrationType(value:string){
 const normalized=normalize(value);
 return Object.entries(concentrationAliases).find(([,aliases])=>aliases.some(alias=>normalized.includes(normalize(alias))))?.[0]||null;
}

function isExactTitleMatch(fragrance:Fragrance,title:string){
 const titleText=normalize(title);
 const expected=[...requiredWords(fragrance.brand),...requiredWords(fragrance.name)];
 if(!expected.length||expected.some(word=>!titleText.split(' ').includes(word)))return false;
 const targetConcentration=concentrationType(fragrance.concentration);
 const titleConcentration=concentrationType(title);
 return !targetConcentration||!titleConcentration||targetConcentration===titleConcentration;
}

function cleanMetadata(value:string|undefined){
 return (value||'').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim().slice(0,400);
}

function safeHttpsUrl(value:string|undefined,hostname:string){
 if(!value)return null;
 try{
  const url=new URL(value);
  return url.protocol==='https:'&&url.hostname===hostname?url.toString():null;
 }catch{return null}
}

async function processJobs(){
 const db=serverDb();
 const cutoff=new Date(Date.now()-24*60*60*1000).toISOString();
 const {data:jobs,error}=await db.from('photo_jobs')
  .select('id,fragrance_id,attempts,status,fragrances(brand,name,concentration)')
  .in('status',['pending','no_match','processing'])
  .lt('attempts',4)
  .or(`last_checked.is.null,last_checked.lt.${cutoff}`)
  .order('last_checked',{ascending:true,nullsFirst:true})
  .limit(3)
  .returns<PhotoJob[]>();
 if(error)throw error;
 let checked=0,candidates=0,failures=0;

 for(const job of jobs||[]){
  const claimQuery=db.from('photo_jobs')
   .update({status:'processing',attempts:job.attempts+1,last_checked:new Date().toISOString()})
   .eq('id',job.id).eq('status',job.status);
  const {data:claim,error:claimError}=job.status==='processing'
   ?await claimQuery.lt('last_checked',cutoff).select('id').maybeSingle()
   :await claimQuery.select('id').maybeSingle();
  if(claimError)throw claimError;
  if(!claim)continue;
  checked++;
  try{
   const fragrance=job.fragrances;
   if(!fragrance)throw Error(`Fragrance ${job.fragrance_id} is unavailable`);
   const api=new URL('https://commons.wikimedia.org/w/api.php');
   api.searchParams.set('action','query');
   api.searchParams.set('generator','search');
   api.searchParams.set('gsrsearch',`filetype:bitmap "${fragrance.brand} ${fragrance.name}"`);
   api.searchParams.set('gsrnamespace','6');
   api.searchParams.set('gsrlimit','20');
   api.searchParams.set('prop','imageinfo');
   api.searchParams.set('iiprop','url|extmetadata');
   api.searchParams.set('iiurlwidth','480');
   api.searchParams.set('format','json');
   api.searchParams.set('formatversion','2');
   const response=await fetch(api,{signal:AbortSignal.timeout(12000),headers:{'User-Agent':'Scentverse/14.0 (licensed fragrance photo discovery; admin review required)'}});
   if(!response.ok)throw Error(`Wikimedia Commons returned ${response.status}`);
   const result=await response.json() as {query?:{pages?:CommonsPage[]}};
   const rows=(result.query?.pages||[]).flatMap(page=>{
    const info=page.imageinfo?.[0];
    const metadata=info?.extmetadata;
    const title=page.title||'';
    const license=cleanMetadata(metadata?.LicenseShortName?.value);
    const imageUrl=safeHttpsUrl(info?.url,'upload.wikimedia.org');
    const sourcePage=safeHttpsUrl(info?.descriptionurl,'commons.wikimedia.org');
    if(!imageUrl||!sourcePage||!metadata||!isExactTitleMatch(fragrance,title)||!allowedLicense.test(license))return [];
    return [{
     fragrance_id:job.fragrance_id,
     source_page:sourcePage,
     candidate_url:imageUrl,
     license_name:license,
     license_url:safeHttpsUrl(cleanMetadata(metadata.LicenseUrl?.value),'creativecommons.org')||safeHttpsUrl(cleanMetadata(metadata.LicenseUrl?.value),'www.creativecommons.org'),
     creator:cleanMetadata(metadata.Artist?.value),
     matched_title:title,
     thumbnail_url:safeHttpsUrl(info.thumburl,'upload.wikimedia.org'),
     match_status:'needs_review'
    }];
   });
   if(rows.length){
    const {error:saveError}=await db.from('photo_candidates').upsert(rows,{onConflict:'fragrance_id,source_page',ignoreDuplicates:true});
    if(saveError)throw saveError;
   }
   const {data:pending,error:pendingError}=await db.from('photo_candidates')
    .select('id').eq('fragrance_id',job.fragrance_id).eq('match_status','needs_review').limit(1);
   if(pendingError)throw pendingError;
   if(pending?.length)candidates+=rows.length;
   const {error:updateError}=await db.from('photo_jobs')
    .update({status:pending?.length?'review':'no_match',last_checked:new Date().toISOString()})
    .eq('id',job.id).eq('status','processing');
   if(updateError)throw updateError;
  }catch(error){
   failures++;
   console.error(`Photo discovery failed for job ${job.id}`,error);
   const {error:updateError}=await db.from('photo_jobs')
    .update({status:'no_match',last_checked:new Date().toISOString()})
    .eq('id',job.id).eq('status','processing');
   if(updateError)throw updateError;
  }
 }
 return {checked,candidates,failures,publication:'None; all matches require admin approval'};
}

async function handle(req:Request){
 const cronSecret=process.env.CRON_SECRET;
 const cronAuthorized=Boolean(cronSecret&&req.headers.get('authorization')===`Bearer ${cronSecret}`);
 if(!sameOrigin(req)||(!authorized(req)&&!cronAuthorized))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{return NextResponse.json(await processJobs())}
 catch(error){console.error('Scheduled photo discovery failed',error);return NextResponse.json({error:'Photo discovery failed'},{status:502})}
}

export const GET=handle;
export const POST=handle;

import {searchBasenotes} from '../../../../../lib/basenotes';
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
  .lt('attempts',100)
  .or(`last_checked.is.null,last_checked.lt.${new Date(Date.now()-60000).toISOString()}`)
  .order('last_checked',{ascending:true,nullsFirst:true})
  .limit(12)
  .returns<PhotoJob[]>();
 if(error)throw error;
 let checked=0,candidates=0,failures=0,basenotesPages=0;

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
   const links=await searchBasenotes(fragrance.brand,fragrance.name).catch(()=>[]);
   basenotesPages+=links.length;
   const api=new URL('https://commons.wikimedia.org/w/api.php');
   api.searchParams.set('action','query');
   api.searchParams.set('generator','search');
   api.searchParams.set('gsrsearch',`filetype:bitmap ${fragrance.brand} ${fragrance.name}`);
   api.searchParams.set('gsrnamespace','6');
   api.searchParams.set('gsrlimit','100');
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
   // Automatically publish only explicitly identified, licensed matches.
   // Ambiguous matches remain available for human review.
   const target=concentrationType(fragrance.concentration);
   const confident=rows.filter(row=>
    Boolean(target&&concentrationType(row.matched_title)===target)
   );

   if(confident.length===1){
    const match=confident[0];
    try{
     const response=await fetch(match.candidate_url,{
      signal:AbortSignal.timeout(12000)
     });
     if(!response.ok)throw Error('Image download failed');
     const mime=(response.headers.get('content-type')||'')
      .split(';')[0].trim().toLowerCase();
     if(!['image/jpeg','image/png','image/webp'].includes(mime))
      throw Error('Unsupported image');
     const bytes=Buffer.from(await response.arrayBuffer());
     if(bytes.length<100||bytes.length>8000000)
      throw Error('Invalid image size');
     const valid=mime==='image/jpeg'
      ?bytes[0]===255&&bytes[1]===216&&bytes[2]===255
      :mime==='image/png'
      ?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      :bytes.toString('ascii',0,4)==='RIFF'
       &&bytes.toString('ascii',8,12)==='WEBP';
     if(!valid)throw Error('Invalid image');
     const ext=mime==='image/jpeg'?'jpg':
      mime==='image/png'?'png':'webp';
     const path=`fragrance-${job.fragrance_id}-auto.${ext}`;
     const {error:uploadError}=await db.storage
      .from('fragrance-photos')
      .upload(path,bytes,{contentType:mime,upsert:true});
     if(uploadError)throw uploadError;
     const {data:link}=db.storage
      .from('fragrance-photos').getPublicUrl(path);
     const {error:photoError}=await db.from('fragrances')
      .update({
       image_url:link.publicUrl,
       photo_status:'verified',
       photo_creator:match.creator,
       photo_license:match.license_name,
       photo_license_url:match.license_url,
       photo_source_url:match.source_page
      }).eq('id',job.fragrance_id);
     if(photoError)throw photoError;
     const {error:doneError}=await db.from('photo_jobs')
      .update({status:'done'})
      .eq('id',job.id);
     if(doneError)throw doneError;
     candidates++;
     continue;
    }catch(e){
     console.error('Automatic photo skipped',e);
    }
   }

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
 return {checked,candidates,failures,basenotesPages,publication:'None; all matches require admin approval'};
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

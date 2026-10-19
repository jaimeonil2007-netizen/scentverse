import {authorized,sameOrigin,serverDb} from '../../../../../lib/db';
import {hasCompatibleConcentration,hasExactBottleDescription,hasExactProductEvidence} from '../../../../../lib/photo-matching';
import {isVerifiedAutoPublishLicense} from '../../../../../lib/photo-rights';
import {fetchWikimediaJson,WikimediaDeferredError} from '../../../../../lib/wikimedia';
import {NextResponse} from 'next/server';

const batchSize=5;
const maximumAttempts=4;
const jobRetryMs=24*60*60*1000;
const staleJobMs=10*60*1000;
const jobSelect='id,fragrance_id,attempts,status,last_checked,next_attempt_at,fragrances(brand,name,concentration,image_url)';

type Fragrance={brand:string;name:string;concentration:string;image_url:string|null};
type PhotoJob={
 id:number;
 fragrance_id:number;
 attempts:number;
 status:string;
 last_checked:string|null;
 next_attempt_at:string|null;
 fragrances:Fragrance|null
};
type CommonsPage={
 title?:string;
 imageinfo?:Array<{
  url?:string;
  thumburl?:string;
  descriptionurl?:string;
  extmetadata?:Record<string,{value?:string}>
 }>
};
type CommonsResult={
 query?:{pages?:CommonsPage[]};
 continue?:Record<string,unknown>
};
type Candidate={
 fragrance_id:number;
 source_page:string;
 candidate_url:string;
 license_name:string|null;
 license_url:string|null;
 creator:string|null;
 rights_basis:string|null;
 matched_title:string;
 thumbnail_url:string|null;
 match_status:'needs_review'
};
type DiscoveredCandidate={
 candidate:Candidate;
 autoEligible:boolean
};

function cleanMetadata(value:string|undefined){
 return (value||'').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&')
  .replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'")
  .replace(/&lt;/g,'<').replace(/&gt;/g,' ')
  .replace(/\s+/g,' ').trim().slice(0,1000);
}

function safeHttpsUrl(value:string|undefined,hosts:string[]){
 if(!value)return null;
 try{
  const url=new URL(value);
  return url.protocol==='https:'&&hosts.includes(url.hostname)?url.toString():null;
 }catch{return null}
}

function safeLicenseUrl(value:string|null){
 if(!value)return null;
 try{
  const url=new URL(value);
  const allowedHost=['creativecommons.org','www.creativecommons.org','publicdomain.org','www.publicdomain.org'].includes(url.hostname);
  return url.protocol==='https:'&&allowedHost?url.toString():null;
 }catch{return null}
}

function commonsCandidates(fragrance:Fragrance,jobId:number,pages:CommonsPage[],completeSearch:boolean){
 const rows:DiscoveredCandidate[]=[];
 for(const page of pages){
  const info=page.imageinfo?.[0];
  const metadata=info?.extmetadata;
  if(!metadata)continue;
  const title=cleanMetadata(page.title);
  const description=cleanMetadata(metadata.ImageDescription?.value);
  const objectName=cleanMetadata(metadata.ObjectName?.value);
  const evidence=`${title} ${objectName} ${description}`;
  const license=cleanMetadata(metadata.LicenseShortName?.value);
  const image=safeHttpsUrl(info.url,['upload.wikimedia.org']);
  const sourcePage=safeHttpsUrl(info.descriptionurl,['commons.wikimedia.org']);
  const licenseUrl=safeLicenseUrl(cleanMetadata(metadata.LicenseUrl?.value)||null);
  if(!image||!sourcePage||!hasExactProductEvidence(fragrance.brand,fragrance.name,evidence)||
   !hasCompatibleConcentration(fragrance.concentration,evidence))continue;
  const creator=cleanMetadata(metadata.Artist?.value)||null;
  const autoEligible=completeSearch&&isVerifiedAutoPublishLicense(license,licenseUrl)&&Boolean(creator)&&
   hasExactBottleDescription(fragrance.brand,fragrance.name,fragrance.concentration,description);
  rows.push({
   candidate:{
    fragrance_id:jobId,
    source_page:sourcePage,
    candidate_url:image,
    license_name:license||null,
    license_url:licenseUrl,
    creator,
    rights_basis:license?`Wikimedia Commons license metadata: ${license}`:null,
    matched_title:title,
    thumbnail_url:safeHttpsUrl(info.thumburl,['upload.wikimedia.org']),
    match_status:'needs_review'
   },
   autoEligible
  });
 }
 return rows;
}

async function discoverCommons(fragrance:Fragrance){
 const api=new URL('https://commons.wikimedia.org/w/api.php');
 api.searchParams.set('action','query');
 api.searchParams.set('generator','search');
 api.searchParams.set('gsrsearch',`filetype:bitmap ${fragrance.brand} "${fragrance.name}"`);
 api.searchParams.set('gsrnamespace','6');
 api.searchParams.set('gsrlimit','50');
 api.searchParams.set('prop','imageinfo');
 api.searchParams.set('iiprop','url|extmetadata');
 api.searchParams.set('iiurlwidth','480');
 api.searchParams.set('format','json');
 api.searchParams.set('formatversion','2');
 const result=await fetchWikimediaJson<CommonsResult>(api);
 return {pages:result.query?.pages||[],completeSearch:!result.continue};
}

function imageSignature(bytes:Buffer,mime:string){
 if(mime==='image/jpeg')return bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
 if(mime==='image/png')return bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 return mime==='image/webp'&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
}

function approvedImageUrl(candidate:Candidate){
 if(candidate.source_page.startsWith('https://commons.wikimedia.org/'))
  return safeHttpsUrl(candidate.candidate_url,['upload.wikimedia.org']);
 return null;
}

async function publishCandidate(db:ReturnType<typeof serverDb>,candidate:Candidate,candidateId:number){
 if(!isVerifiedAutoPublishLicense(candidate.license_name,candidate.license_url))
  throw Error('Photo license is not verified for automatic publication');
 const {data:fragrance,error:fragranceError}=await db.from('fragrances')
  .select('id,image_url').eq('id',candidate.fragrance_id).maybeSingle();
 if(fragranceError)throw fragranceError;
 if(!fragrance||fragrance.image_url)return false;
 const imageUrl=approvedImageUrl(candidate);
 if(!imageUrl)throw Error('Image URL is outside an approved source');
 const response=await fetch(imageUrl,{signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error(`Image download failed with HTTP ${response.status}`);
 if(!approvedImageUrl({...candidate,candidate_url:response.url}))
  throw Error('Image redirect left the approved source');
 const mime=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
 if(!['image/jpeg','image/png','image/webp'].includes(mime))
  throw Error('Unsupported image type');
 const bytes=Buffer.from(await response.arrayBuffer());
 if(bytes.length<100||bytes.length>8_000_000||!imageSignature(bytes,mime))
  throw Error('Invalid image data or size');
 const extension=mime==='image/jpeg'?'jpg':mime==='image/png'?'png':'webp';
 const path=`fragrance-${candidate.fragrance_id}-${candidateId}.${extension}`;
 const storage=db.storage.from('fragrance-photos');
 const {error:uploadError}=await storage.upload(path,bytes,{contentType:mime,upsert:false});
 if(uploadError)throw uploadError;
 const {data:link}=storage.getPublicUrl(path);
 const {data:updated,error:updateError}=await db.from('fragrances').update({
  image_url:link.publicUrl,
  photo_status:'verified',
  photo_creator:candidate.creator,
  photo_license:candidate.license_name,
  photo_license_url:candidate.license_url,
  photo_source_url:candidate.source_page
 }).eq('id',candidate.fragrance_id).is('image_url',null).select('id').maybeSingle();
 if(updateError){
  const {error:removeError}=await storage.remove([path]);
  if(removeError)console.error('Could not remove unpublished fragrance photo',removeError);
  throw updateError;
 }
 if(!updated){
  const {error:removeError}=await storage.remove([path]);
  if(removeError)throw removeError;
  return false;
 }
 return true;
}

function eligibleJob(job:PhotoJob,now:number){
 if(job.fragrances?.image_url||job.attempts>=maximumAttempts)return false;
 if(job.next_attempt_at&&Date.parse(job.next_attempt_at)>now)return false;
 if(job.status==='processing')
  return Boolean(job.last_checked&&Date.parse(job.last_checked)<now-staleJobMs);
 if(job.status==='no_match')
  return !job.last_checked||Date.parse(job.last_checked)<now-jobRetryMs;
 return job.status==='pending';
}

async function processJobs(){
 const db=serverDb();
 const now=Date.now();
 const dueRetry=new Date(now-jobRetryMs).toISOString();
 const staleBefore=new Date(now-staleJobMs).toISOString();
 const [pendingResult,retryResult,staleResult]=await Promise.all([
  db.from('photo_jobs').select(jobSelect).eq('status','pending')
    .lt('attempts',maximumAttempts).or(`next_attempt_at.is.null,next_attempt_at.lte.${new Date(now).toISOString()}`)
    .order('created_at',{ascending:true})
   .limit(batchSize).returns<PhotoJob[]>(),
   db.from('photo_jobs').select(jobSelect).eq('status','no_match')
    .lt('attempts',maximumAttempts).or(`last_checked.is.null,last_checked.lt.${dueRetry}`)
   .order('last_checked',{ascending:true,nullsFirst:true})
   .limit(batchSize).returns<PhotoJob[]>(),
  db.from('photo_jobs').select(jobSelect).eq('status','processing')
   .lt('attempts',maximumAttempts).lt('last_checked',staleBefore)
   .order('last_checked',{ascending:true}).limit(batchSize).returns<PhotoJob[]>()
 ]);
 const queueError=pendingResult.error||retryResult.error||staleResult.error;
 if(queueError)throw queueError;
 const queued=[...(pendingResult.data||[]),...(retryResult.data||[]),...(staleResult.data||[])];
 const jobs=queued.filter(job=>eligibleJob(job,now)).slice(0,batchSize);
 const stats={checked:0,found:0,autoPublished:0,needsReview:0,errors:0};

 for(const job of jobs){
  const claimTime=new Date().toISOString();
  let claimQuery=db.from('photo_jobs').update({
   status:'processing',
   attempts:job.attempts+1,
   last_checked:claimTime,
   next_attempt_at:null
  }).eq('id',job.id).eq('status',job.status).lt('attempts',maximumAttempts);
  if(job.status==='processing')
   claimQuery=claimQuery.lt('last_checked',new Date(now-staleJobMs).toISOString());
  const {data:claim,error:claimError}=await claimQuery.select('id').maybeSingle();
  if(claimError)throw claimError;
  if(!claim)continue;
  stats.checked++;
  let jobHadError=false;
  let deferredUntil:Date|null=null;
  try{
   const fragrance=job.fragrances;
   if(!fragrance)throw Error(`Fragrance ${job.fragrance_id} is unavailable`);
   if(fragrance.image_url){
    const {error}=await db.from('photo_jobs').update({status:'done'}).eq('id',job.id);
    if(error)throw error;
    continue;
   }
   const discovered:DiscoveredCandidate[]=[];
   try{
    const commons=await discoverCommons(fragrance);
    discovered.push(...commonsCandidates(fragrance,job.fragrance_id,commons.pages,commons.completeSearch));
   }catch(error){
    if(error instanceof WikimediaDeferredError){
     deferredUntil=error.retryAt;
    }else{
     jobHadError=true;
     console.error(`Wikimedia search failed for photo job ${job.id}`,error);
    }
   }

   const unique=new Map<string,DiscoveredCandidate>();
   for(const row of discovered){
    if(!unique.has(row.candidate.source_page))unique.set(row.candidate.source_page,row);
   }
   const results=[...unique.values()];
   stats.found+=results.length;
   if(results.length){
    const {error:saveError}=await db.from('photo_candidates')
     .upsert(results.map(row=>row.candidate),{onConflict:'fragrance_id,source_page',ignoreDuplicates:true});
    if(saveError)throw saveError;
   }

   let autoPublished=false;
   if(results.length===1&&results[0].autoEligible){
    const match=results[0].candidate;
     const {count:pendingCandidates,error:pendingCandidatesError}=await db.from('photo_candidates')
      .select('id',{count:'exact',head:true})
      .eq('fragrance_id',job.fragrance_id).eq('match_status','needs_review');
     if(pendingCandidatesError)throw pendingCandidatesError;
     const {data:stored,error:storedError}=await db.from('photo_candidates')
      .select('*').eq('fragrance_id',job.fragrance_id)
      .eq('source_page',match.source_page).maybeSingle<Candidate&{id:number}>();
     if(storedError)throw storedError;
     if(pendingCandidates===1&&stored?.match_status==='needs_review'&&
      stored.candidate_url===match.candidate_url&&
      stored.license_name===match.license_name&&
      stored.license_url===match.license_url&&
      stored.creator===match.creator&&
      stored.rights_basis===match.rights_basis){
      try{
       const published=await publishCandidate(db,stored,stored.id);
       if(published){
        const {data:approved,error:approvalError}=await db.from('photo_candidates')
         .update({match_status:'approved'}).eq('id',stored.id)
         .eq('match_status','needs_review').select('id').maybeSingle();
        if(approvalError)throw approvalError;
        if(!approved)throw Error('Photo candidate could not be marked approved after publication');
        autoPublished=true;
        stats.autoPublished++;
       }
      }catch(error){
       jobHadError=true;
      console.error(`Automatic publication failed for photo job ${job.id}`,error);
     }
    }
   }

   let reviewCount=0;
   if(results.length){
    const {count,error:reviewError}=await db.from('photo_candidates')
     .select('id',{count:'exact',head:true})
     .eq('fragrance_id',job.fragrance_id).eq('match_status','needs_review')
     .in('source_page',results.map(result=>result.candidate.source_page));
    if(reviewError)throw reviewError;
    reviewCount=count||0;
   }
   stats.needsReview+=reviewCount;
   const status=autoPublished?'done':reviewCount?'review':deferredUntil?'pending':'no_match';
   const {error:updateError}=await db.from('photo_jobs').update({
    status,
    last_checked:new Date().toISOString(),
    next_attempt_at:deferredUntil?.toISOString()||null
   }).eq('id',job.id).eq('status','processing');
   if(updateError)throw updateError;
   if(jobHadError)stats.errors++;
   if(autoPublished)continue;
  }catch(error){
   stats.errors++;
   console.error(`Photo discovery failed for job ${job.id}`,error);
   const {error:updateError}=await db.from('photo_jobs').update({
    status:'no_match',
    last_checked:new Date().toISOString(),
    next_attempt_at:null
   }).eq('id',job.id).eq('status','processing');
   if(updateError)throw updateError;
  }
 }

 const {error:runError}=await db.from('photo_runs').insert({
  checked:stats.checked,
  found:stats.found,
  auto_published:stats.autoPublished,
  needs_review:stats.needsReview,
  errors:stats.errors
 });
 if(runError)throw runError;
 return stats;
}

async function handle(req:Request){
 const cronSecret=process.env.CRON_SECRET;
 const cronAuthorized=Boolean(cronSecret&&req.headers.get('authorization')===`Bearer ${cronSecret}`);
 if(!sameOrigin(req)||(!authorized(req)&&!cronAuthorized))
  return NextResponse.json({error:'Unauthorized'},{status:401});
 try{return NextResponse.json(await processJobs())}
 catch(error){
  console.error('Scheduled photo discovery failed',error);
  return NextResponse.json({error:'Photo discovery failed'},{status:502});
 }
}

export const GET=handle;
export const POST=handle;

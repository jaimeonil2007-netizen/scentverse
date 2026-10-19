import {NextResponse} from 'next/server';
import {authorized,sameOrigin,serverDb} from '../../../../../lib/db';
import {hasConsistentLicenseReference,isPermittedLicenseName} from '../../../../../lib/photo-rights';
type Candidate={id:number;fragrance_id:number;candidate_url:string;source_page:string;license_name:string|null;license_url:string|null;creator:string|null;rights_basis:string|null;match_status:string};

function hasImageSignature(bytes:Buffer,contentType:string){
 if(contentType==='image/jpeg')return bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
 if(contentType==='image/png')return bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(contentType==='image/webp')return bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 return false;
}

function safeHttpsUrl(value:string,hostnames:string[]){
 try{
  const url=new URL(value);
  return url.protocol==='https:'&&hostnames.includes(url.hostname)?url.toString():null;
 }catch{return null}
}

function candidateUrls(candidate:Candidate){
 let sourceUrl:URL;
 try{sourceUrl=new URL(candidate.source_page)}catch{return null}
 if(sourceUrl.protocol!=='https:'||sourceUrl.hostname!=='commons.wikimedia.org')return null;
 if(sourceUrl.hostname==='commons.wikimedia.org'){
  const source=safeHttpsUrl(candidate.source_page,['commons.wikimedia.org']);
  const image=safeHttpsUrl(candidate.candidate_url,['upload.wikimedia.org']);
  return source&&image?{source,image}:null;
 }
 return null;
}

export async function POST(req:Request){
 if(!sameOrigin(req)||!authorized(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{
  const body=await req.json() as {candidateId?:unknown;confirmedExactEdition?:unknown;confirmedLicense?:unknown};
  const candidateId=Number(body.candidateId);
  if(!Number.isSafeInteger(candidateId)||candidateId<1)return NextResponse.json({error:'Valid candidateId required'},{status:400});
  if(body.confirmedExactEdition!==true||body.confirmedLicense!==true)return NextResponse.json({error:'Both identity and license confirmations required'},{status:400});
  const db=serverDb();
  const {data:candidate,error}=await db.from('photo_candidates').select('*').eq('id',candidateId).maybeSingle<Candidate>();
  if(error)throw error;
  if(!candidate||candidate.match_status!=='needs_review')return NextResponse.json({error:'Pending candidate not found'},{status:404});
  if(!isPermittedLicenseName(candidate.license_name))
   return NextResponse.json({error:'Candidate license is not permitted'},{status:400});
  if(!candidate.creator)return NextResponse.json({error:'Creator attribution is required'},{status:400});
  const urls=candidateUrls(candidate);
  if(!urls){
   return NextResponse.json({error:'Unsupported image source'},{status:400});
  }
  if(!hasConsistentLicenseReference(candidate.license_name,candidate.license_url))
   return NextResponse.json({error:'License reference does not match a supported reuse license'},{status:400});
  const licenseUrl=candidate.license_url;
  const {data:fragrance,error:fragranceError}=await db.from('fragrances')
   .select('id,image_url').eq('id',candidate.fragrance_id).maybeSingle();
  if(fragranceError)throw fragranceError;
  if(!fragrance)return NextResponse.json({error:'Fragrance not found'},{status:404});
  if(fragrance.image_url)return NextResponse.json({error:'This fragrance already has an image; it was not overwritten'},{status:409});
  const response=await fetch(urls.image,{signal:AbortSignal.timeout(20000)});
  if(!response.ok)return NextResponse.json({error:'Image download failed'},{status:502});
  if(!candidateUrls({...candidate,candidate_url:response.url}))
   return NextResponse.json({error:'Image redirect left the approved source'},{status:400});
  const contentType=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>8_000_000)return NextResponse.json({error:'Image too large'},{status:400});
  if(!hasImageSignature(bytes,contentType))return NextResponse.json({error:'Unsupported or invalid image data'},{status:400});
  const ext=contentType==='image/jpeg'?'jpg':contentType==='image/png'?'png':'webp';
  const path=`fragrance-${candidate.fragrance_id}-${candidate.id}.${ext}`;
  const storage=db.storage.from('fragrance-photos');
  const {error:uploadError}=await storage.upload(path,bytes,{contentType,upsert:false});
  if(uploadError)throw uploadError;
  const {data:link}=storage.getPublicUrl(path);
  const {data:updated,error:updateError}=await db.from('fragrances').update({
   image_url:link.publicUrl,
   photo_status:'verified',
   photo_creator:candidate.creator,
   photo_license:candidate.license_name,
   photo_license_url:licenseUrl,
   photo_source_url:urls.source
  }).eq('id',candidate.fragrance_id).is('image_url',null).select('id').maybeSingle();
  if(updateError){
   const {error:removeError}=await storage.remove([path]);
   if(removeError)console.error('Could not remove unpublished fragrance photo',removeError);
   throw updateError;
  }
  if(!updated){
   const {error:removeError}=await storage.remove([path]);
   if(removeError)throw removeError;
   return NextResponse.json({error:'This fragrance already has an image; it was not overwritten'},{status:409});
  }
  const {error:approvalError}=await db.from('photo_candidates').update({match_status:'approved'}).eq('id',candidate.id).eq('match_status','needs_review');
  if(approvalError)throw approvalError;
  const {error:jobError}=await db.from('photo_jobs').update({status:'done'}).eq('fragrance_id',candidate.fragrance_id);
  if(jobError)throw jobError;
  return NextResponse.json({published:true,url:link.publicUrl,attribution:{creator:candidate.creator,license:candidate.license_name,licenseUrl,source:candidate.source_page}});
 }catch(error){
  console.error('Photo approval failed',error);
  return NextResponse.json({error:'Approval failed'},{status:500});
 }
}

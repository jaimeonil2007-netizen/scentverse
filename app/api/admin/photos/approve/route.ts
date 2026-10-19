import {NextResponse} from 'next/server';
import {authorized,sameOrigin,serverDb} from '../../../../../lib/db';

const permitted=/^(CC0(?: 1\.0)?|CC BY(?:-SA)? (?:3\.0|4\.0)|Public domain(?: mark 1\.0)?)$/i;
type Candidate={id:number;fragrance_id:number;candidate_url:string;source_page:string;license_name:string|null;license_url:string|null;creator:string|null;match_status:string};

function hasImageSignature(bytes:Buffer,contentType:string){
 if(contentType==='image/jpeg')return bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
 if(contentType==='image/png')return bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(contentType==='image/webp')return bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 return false;
}

function safeHttpsUrl(value:string,hostname:string){
 try{
  const url=new URL(value);
  return url.protocol==='https:'&&url.hostname===hostname?url.toString():null;
 }catch{return null}
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
  if(!candidate.license_name||!permitted.test(candidate.license_name))return NextResponse.json({error:'Candidate license is not permitted'},{status:400});
  const source=safeHttpsUrl(candidate.source_page,'commons.wikimedia.org');
  const image=safeHttpsUrl(candidate.candidate_url,'upload.wikimedia.org');
  if(!source||!image){
   return NextResponse.json({error:'Unsupported image source'},{status:400});
  }
  let licenseUrl:string|null=null;
  if(candidate.license_url){
   licenseUrl=safeHttpsUrl(candidate.license_url,'creativecommons.org')||safeHttpsUrl(candidate.license_url,'www.creativecommons.org');
   if(!licenseUrl){
    return NextResponse.json({error:'Unsupported license reference'},{status:400});
   }
  }
  const response=await fetch(image,{signal:AbortSignal.timeout(20000)});
  if(!response.ok)return NextResponse.json({error:'Image download failed'},{status:502});
  const contentType=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>8_000_000)return NextResponse.json({error:'Image too large'},{status:400});
  if(!hasImageSignature(bytes,contentType))return NextResponse.json({error:'Unsupported or invalid image data'},{status:400});
  const ext=contentType==='image/jpeg'?'jpg':contentType==='image/png'?'png':'webp';
  const path=`fragrance-${candidate.fragrance_id}-${candidate.id}.${ext}`;
  const {error:uploadError}=await db.storage.from('fragrance-photos').upload(path,bytes,{contentType,upsert:true});
  if(uploadError)throw uploadError;
  const {data:link}=db.storage.from('fragrance-photos').getPublicUrl(path);
  const {error:updateError}=await db.from('fragrances').update({
   image_url:link.publicUrl,
   photo_status:'verified',
   photo_creator:candidate.creator,
   photo_license:candidate.license_name,
   photo_license_url:licenseUrl,
   photo_source_url:candidate.source_page
  }).eq('id',candidate.fragrance_id);
  if(updateError)throw updateError;
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

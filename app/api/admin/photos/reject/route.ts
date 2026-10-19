import {NextResponse} from 'next/server';
import {authorized,sameOrigin,serverDb} from '../../../../../lib/db';

export async function POST(req:Request){
 if(!sameOrigin(req)||!authorized(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{
  const body=await req.json() as {candidateId?:unknown};
  const candidateId=Number(body.candidateId);
  if(!Number.isSafeInteger(candidateId)||candidateId<1)return NextResponse.json({error:'Valid candidateId required'},{status:400});
  const db=serverDb();
  const {data:candidate,error}=await db.from('photo_candidates').update({match_status:'rejected'})
   .eq('id',candidateId).eq('match_status','needs_review').select('id,fragrance_id').maybeSingle();
  if(error)throw error;
  if(!candidate)return NextResponse.json({error:'Pending candidate not found'},{status:404});
  const {error:jobError}=await db.from('photo_jobs').update({status:'no_match',last_checked:new Date().toISOString()})
   .eq('fragrance_id',candidate.fragrance_id);
  if(jobError)throw jobError;
  return NextResponse.json({rejected:true});
 }catch(error){
  console.error('Photo candidate rejection failed',error);
  return NextResponse.json({error:'Could not reject photo candidate'},{status:500});
 }
}

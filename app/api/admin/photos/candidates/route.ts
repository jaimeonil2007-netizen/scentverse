import {NextResponse} from 'next/server';
import {authorized,serverDb} from '../../../../../lib/db';

export async function GET(req:Request){
 if(!authorized(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{
  const db=serverDb();
  const [candidateResult,missingResult,queueResult,runResult]=await Promise.all([
   db.from('photo_candidates')
   .select('id,fragrance_id,candidate_url,thumbnail_url,source_page,license_name,license_url,creator,rights_basis,matched_title,fragrances(brand,name,concentration)',{count:'exact'})
   .eq('match_status','needs_review')
   .order('created_at',{ascending:true})
   .limit(100),
   db.from('fragrances').select('id',{count:'exact',head:true}).is('image_url',null),
   db.from('photo_jobs').select('id',{count:'exact',head:true}).eq('status','pending'),
   db.from('photo_runs').select('checked,found,auto_published,needs_review,errors,completed_at')
    .order('completed_at',{ascending:false}).limit(1).maybeSingle()
  ]);
  const error=candidateResult.error||missingResult.error||queueResult.error||runResult.error;
  if(error)throw error;
  return NextResponse.json({
   candidates:candidateResult.data||[],
   counts:{
    pendingCandidates:candidateResult.count||0,
    missingFragrances:missingResult.count||0,
    queuedJobs:queueResult.count||0
   },
   lastRun:runResult.data?{
    checked:runResult.data.checked,
    found:runResult.data.found,
    autoPublished:runResult.data.auto_published,
    needsReview:runResult.data.needs_review,
    errors:runResult.data.errors,
    completedAt:runResult.data.completed_at
   }:null
  });
 }catch(error){
  console.error('Photo candidate listing failed',error);
  return NextResponse.json({error:'Could not load photo candidates'},{status:500});
 }
}

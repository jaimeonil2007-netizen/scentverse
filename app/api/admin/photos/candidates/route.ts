import {NextResponse} from 'next/server';
import {authorized,serverDb} from '../../../../../lib/db';

export async function GET(req:Request){
 if(!authorized(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{
  const {data,error}=await serverDb().from('photo_candidates')
   .select('id,fragrance_id,candidate_url,thumbnail_url,source_page,license_name,license_url,creator,matched_title,fragrances(brand,name,concentration)')
   .eq('match_status','needs_review')
   .order('created_at',{ascending:true})
   .limit(100);
  if(error)throw error;
  return NextResponse.json({candidates:data||[]});
 }catch(error){
  console.error('Photo candidate listing failed',error);
  return NextResponse.json({error:'Could not load photo candidates'},{status:500});
 }
}

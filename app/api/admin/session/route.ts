import {NextResponse} from 'next/server';
import {adminSessionCookieName,adminSessionMaxAge,adminTokenMatches,createAdminSession,sameOrigin} from '../../../../lib/db';

export async function POST(req:Request){
 if(!sameOrigin(req))return NextResponse.json({error:'Invalid request origin'},{status:403});
 try{
  const body=await req.json() as {token?:unknown};
  if(typeof body.token!=='string'||!adminTokenMatches(body.token))return NextResponse.json({error:'Invalid admin token'},{status:401});
  const response=NextResponse.json({authenticated:true});
  response.cookies.set(adminSessionCookieName,createAdminSession(),{
   httpOnly:true,
   secure:new URL(req.url).protocol==='https:',
   sameSite:'strict',
   path:'/',
   maxAge:adminSessionMaxAge
  });
  return response;
 }catch(error){
  console.error('Admin login failed',error);
  return NextResponse.json({error:'Admin login failed'},{status:500});
 }
}

export async function DELETE(req:Request){
 if(!sameOrigin(req))return NextResponse.json({error:'Invalid request origin'},{status:403});
 const response=NextResponse.json({authenticated:false});
 response.cookies.set(adminSessionCookieName,'',{httpOnly:true,secure:new URL(req.url).protocol==='https:',sameSite:'strict',path:'/',maxAge:0});
 return response;
}

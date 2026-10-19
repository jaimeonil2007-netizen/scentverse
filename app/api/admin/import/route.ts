import {NextResponse} from 'next/server';
import {authorized,sameOrigin,serverDb} from '../../../../lib/db';

type ImportItem={brand:string;name:string;concentration:string;family:string;notes:string[]};

function text(value:unknown,maxLength:number){
 return typeof value==='string'?value.trim().slice(0,maxLength):'';
}

export async function POST(req:Request){
 if(!sameOrigin(req)||!authorized(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{
  const body=await req.json() as {items?:unknown};
  if(!Array.isArray(body.items)||body.items.length<1||body.items.length>500)return NextResponse.json({error:'Provide 1–500 items'},{status:400});
  const items:ImportItem[]=body.items.map((value:unknown)=>{
   const item=value&&typeof value==='object'?value as Record<string,unknown>:{};
   return {
    brand:text(item.brand,150),
    name:text(item.name,200),
    concentration:text(item.concentration,100),
    family:text(item.family,80)||'Other',
    notes:Array.isArray(item.notes)?item.notes.filter((note):note is string=>typeof note==='string').slice(0,30).map(note=>note.slice(0,100)):[]
   };
  });
  if(items.some(item=>!item.brand||!item.name||!item.concentration))return NextResponse.json({error:'brand, name and concentration required'},{status:400});
  const db=serverDb();
  const {data,error}=await db.from('fragrances').upsert(items,{onConflict:'brand,name,concentration',ignoreDuplicates:true}).select('id');
  if(error)throw error;
  const ids=(data||[]).map(item=>({fragrance_id:item.id,status:'pending'}));
  if(ids.length){
   const {error:queueError}=await db.from('photo_jobs').upsert(ids,{onConflict:'fragrance_id',ignoreDuplicates:true});
   if(queueError)throw queueError;
  }
  return NextResponse.json({imported:data?.length||0,queued:ids.length});
 }catch(error){
  console.error('Fragrance import failed',error);
  return NextResponse.json({error:'Import failed; check database and input'},{status:500});
 }
}

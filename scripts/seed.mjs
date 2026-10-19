import {createClient} from '@supabase/supabase-js';
import {readFileSync} from 'node:fs';

const url=process.env.SCENTVERSE_SUPABASE_URL;
const key=process.env.SCENTVERSE_SUPABASE_SECRET_KEY;
if(!url||!key)throw Error('Set Supabase env vars first');

const db=createClient(url,key);
const items=JSON.parse(readFileSync(new URL('../lib/catalog.json',import.meta.url))).map(item=>({
 id:item.id,
 brand:item.brand,
 name:item.name,
 concentration:item.concentration,
 family:item.family,
 notes:item.notes,
 image_url:item.image||null,
 photo_status:item.image?'verified':'missing'
}));
const {error}=await db.from('fragrances').upsert(items,{onConflict:'id',ignoreDuplicates:true});
if(error)throw error;

const {data:missing,error:lookupError}=await db.from('fragrances').select('id').is('image_url',null).eq('photo_status','missing');
if(lookupError)throw lookupError;
if(missing?.length){
 const {error:queueError}=await db.from('photo_jobs').upsert(missing.map(item=>({fragrance_id:item.id,status:'pending'})),{onConflict:'fragrance_id',ignoreDuplicates:true});
 if(queueError)throw queueError;
}
console.log(`Added any missing seed records; ${missing?.length||0} fragrances without photos are queued`);

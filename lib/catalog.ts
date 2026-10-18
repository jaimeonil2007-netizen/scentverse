import seed from './seed.json';
import { createClient } from '@supabase/supabase-js';
export type Fragrance = {id:number;brand:string;name:string;family:string;notes:string[];desc:string;m:number[];pop:number;concentration:string;photo_url?:string;photo_status?:string;credit?:string;source?:string;licenseURL?:string;changes?:string;identitySource?:string;photoReason?:string};
export const starter = seed as Fragrance[];
export function db(){const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;return url&&key?createClient(url,key,{auth:{persistSession:false}}):null}
export async function catalog():Promise<Fragrance[]>{const client=db();if(!client)return starter;const {data,error}=await client.from('fragrances').select('*').order('id',{ascending:true}).limit(20000);if(error||!data?.length)return starter;return data as Fragrance[]}
export function requireAdmin(req:Request){const expected=process.env.SCENTVERSE_ADMIN_TOKEN;const given=req.headers.get('authorization');return !!expected&&expected.length>=24&&given===`Bearer ${expected}`}
export const licenseKinds=['CC0','CC BY 2.0','CC BY 4.0','CC BY-SA 4.0','Unsplash License','Pexels License','Explicit commercial permission'] as const;

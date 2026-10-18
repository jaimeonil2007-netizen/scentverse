import {createClient} from '@supabase/supabase-js';
export function serverDb(){const url=process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw Error('Supabase not configured');return createClient(url,key,{auth:{persistSession:false}})}
export function configured(){return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY)}
export function authorized(req:Request){const token=process.env.ADMIN_API_TOKEN;return Boolean(token&&req.headers.get('authorization')===`Bearer ${token}`)}

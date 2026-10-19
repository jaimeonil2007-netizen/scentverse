import {createClient} from '@supabase/supabase-js';
import {createHmac,timingSafeEqual} from 'node:crypto';

const sessionCookie='sv_admin_session';
const sessionDuration=12*60*60;

export function serverDb(){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw Error('Supabase not configured');
 return createClient(url,key,{auth:{persistSession:false}});
}

export function configured(){
 return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function matchesSecret(value:string,secret:string){
 const actual=Buffer.from(value);
 const expected=Buffer.from(secret);
 return actual.length===expected.length&&timingSafeEqual(actual,expected);
}

function sessionSignature(expiry:number){
 const secret=process.env.ADMIN_API_TOKEN;
 if(!secret)throw Error('Admin authentication is not configured');
 return createHmac('sha256',secret).update(`scentverse-admin:${expiry}`).digest('base64url');
}

export function createAdminSession(){
 const expiry=Math.floor(Date.now()/1000)+sessionDuration;
 return `${expiry}.${sessionSignature(expiry)}`;
}

function hasAdminSession(req:Request){
 const secret=process.env.ADMIN_API_TOKEN;
 const cookie=req.headers.get('cookie')?.split(';').map(value=>value.trim()).find(value=>value.startsWith(`${sessionCookie}=`));
 if(!secret||!cookie)return false;
 const session=cookie.slice(sessionCookie.length+1);
 const separator=session.indexOf('.');
 if(separator<1)return false;
 const expiry=Number(session.slice(0,separator));
 if(!Number.isSafeInteger(expiry)||expiry<=Math.floor(Date.now()/1000))return false;
 return matchesSecret(session.slice(separator+1),sessionSignature(expiry));
}

export function authorized(req:Request){
 const token=process.env.ADMIN_API_TOKEN;
 const authorization=req.headers.get('authorization');
 return Boolean(token&&authorization&&matchesSecret(authorization,`Bearer ${token}`))||hasAdminSession(req);
}

export function adminTokenMatches(value:string){
 const token=process.env.ADMIN_API_TOKEN;
 return Boolean(token&&matchesSecret(value,token));
}

export function sameOrigin(req:Request){
 const origin=req.headers.get('origin');
 if(!origin)return true;
 try{return new URL(origin).origin===new URL(req.url).origin}catch{return false}
}

export const adminSessionCookieName=sessionCookie;
export const adminSessionMaxAge=sessionDuration;

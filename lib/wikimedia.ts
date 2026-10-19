import {maximumRetries,minimumSpacingMs,parseRetryAfter,retryDelay} from './wikimedia-retry';

let previousRequestAt=0;
let requestQueue=Promise.resolve();

export class WikimediaDeferredError extends Error{
 constructor(readonly retryAt:Date){
  super('Wikimedia requested a longer retry delay; the job was deferred');
  this.name='WikimediaDeferredError';
 }
}

function sleep(milliseconds:number){
 return new Promise(resolve=>setTimeout(resolve,milliseconds));
}

async function waitForSpacing(){
 const previous=requestQueue;
 let release!:()=>void;
 requestQueue=new Promise<void>(resolve=>{release=resolve});
 await previous;
 try{
  const wait=Math.max(0,previousRequestAt+minimumSpacingMs-Date.now());
  if(wait)await sleep(wait);
  previousRequestAt=Date.now();
 }finally{release()}
}

export async function fetchWikimediaJson<T>(url:URL){
 for(let attempt=0;attempt<=maximumRetries;attempt++){
  await waitForSpacing();
  const response=await fetch(url,{
   signal:AbortSignal.timeout(15000),
   headers:{
    'Api-User-Agent':'SCENTVERSE/14.0 (licensed fragrance-photo discovery; admin contact)',
    Accept:'application/json'
   }
  });
  if(response.ok){
   const payload=await response.json() as T&{error?:{code?:string;info?:string}};
   if(payload.error)throw Error(`Wikimedia API error ${payload.error.code||'unknown'}: ${payload.error.info||'request failed'}`);
   return payload;
  }
  if(response.status!==429&&response.status!==503)throw Error(`Wikimedia Commons returned ${response.status}`);
  if(attempt===maximumRetries)throw Error(`Wikimedia Commons retry limit reached after HTTP ${response.status}`);
  const now=Date.now();
  const retryAfter=parseRetryAfter(response.headers.get('retry-after'),now);
  const delay=retryDelay(retryAfter,attempt);
  if(delay.deferred){
   throw new WikimediaDeferredError(new Date(now+delay.waitMs));
  }
  await sleep(delay.waitMs);
 }
 throw Error('Wikimedia Commons retry limit reached');
}

export const minimumSpacingMs=1200;
export const maximumRetryWaitMs=30000;
export const maximumRetries=3;

export function parseRetryAfter(value:string|null,now:number){
 if(!value)return null;
 const seconds=Number(value);
 const at=Number.isFinite(seconds)?now+Math.max(0,seconds)*1000:Date.parse(value);
 return Number.isFinite(at)?Math.max(0,at-now):null;
}

export function retryDelay(retryAfterMs:number|null,attempt:number){
 const exponentialMs=Math.min(1000*2**attempt,maximumRetryWaitMs);
 const waitMs=Math.max(retryAfterMs??0,exponentialMs);
 return {waitMs,deferred:waitMs>maximumRetryWaitMs};
}

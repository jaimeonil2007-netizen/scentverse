import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadTypeScript(relativePath,imports={}){
 const source=await readFile(new URL(relativePath,import.meta.url),'utf8');
 const result=ts.transpileModule(source,{
  compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}
 });
 let output=result.outputText;
 for(const [specifier,url] of Object.entries(imports))
  output=output.replaceAll(specifier,url);
 return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

const matching=await loadTypeScript('../lib/photo-matching.ts');
const rights=await loadTypeScript('../lib/photo-rights.ts');
const retrySource=await readFile(new URL('../lib/wikimedia-retry.ts',import.meta.url),'utf8');
const retryOutput=ts.transpileModule(retrySource,{
 compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}
}).outputText;
const retryUrl=`data:text/javascript;base64,${Buffer.from(retryOutput).toString('base64')}`;
const retry=await import(retryUrl);
const wikimedia=await loadTypeScript('../lib/wikimedia.ts',{'./wikimedia-retry':retryUrl});

test('concentration aliases match full names and reject conflicting editions',()=>{
 assert.deepEqual([...matching.concentrationTypes('Eau de Toilette')],['eau de toilette']);
 assert.deepEqual([...matching.concentrationTypes('EDP')],['eau de parfum']);
 assert.equal(matching.hasCompatibleConcentration('EDT','Eau de Toilette bottle'),true);
 assert.equal(matching.hasCompatibleConcentration('EDT','EDP bottle'),false);
});

test('automatic identity checks require exact fragrance, concentration, and bottle evidence',()=>{
 assert.equal(matching.hasExactBottleDescription(
  'Maison Example','No. 5','Eau de Parfum',
  'Maison Example No. 5 Eau de Parfum bottle, front view'
 ),true);
 assert.equal(matching.hasExactBottleDescription(
  'Maison Example','No. 5','EDT','Maison Example No. 5 Eau de Parfum bottle'
 ),false);
 assert.equal(matching.hasExactBottleDescription(
  'Maison Example','No. 5','EDP','Maison Example No. 5 Eau de Parfum bottle'
 ),true);
 assert.equal(matching.hasExactBottleDescription(
  'Maison Example','No. 5','EDP','Maison Example No. 5 EDP package'
 ),false);
});

test('automatic reuse rights require an exact supported license URL',()=>{
 assert.equal(rights.isVerifiedAutoPublishLicense(
  'CC BY-SA 4.0','https://creativecommons.org/licenses/by-sa/4.0/'
 ),true);
 assert.equal(rights.isVerifiedAutoPublishLicense(
  'CC BY-SA 4.0','https://creativecommons.org/licenses/by/4.0/'
 ),false);
 assert.equal(rights.isVerifiedAutoPublishLicense(
  'CC BY 2.0','https://creativecommons.org/licenses/by/2.0/'
 ),false);
 assert.equal(rights.isPermittedLicenseName('Public domain'),true);
 assert.equal(rights.hasConsistentLicenseReference('CC BY 4.0',null),false);
});

test('Retry-After seconds and HTTP dates are parsed',()=>{
 const now=Date.parse('2026-10-19T00:00:00Z');
 assert.equal(retry.parseRetryAfter('4',now),4000);
 assert.equal(retry.parseRetryAfter('Mon, 19 Oct 2026 00:00:08 GMT',now),8000);
 assert.equal(retry.parseRetryAfter('invalid',now),null);
});

test('Wikimedia retry delays apply exponential backoff and defer long Retry-After requests',()=>{
 assert.deepEqual(retry.retryDelay(null,0),{waitMs:1000,deferred:false});
 assert.deepEqual(retry.retryDelay(null,2),{waitMs:4000,deferred:false});
 assert.deepEqual(retry.retryDelay(10000,1),{waitMs:10000,deferred:false});
 assert.deepEqual(retry.retryDelay(60000,0),{waitMs:60000,deferred:true});
});

test('Wikimedia API defers a 429 response when Retry-After exceeds the in-request limit',async()=>{
 const originalFetch=globalThis.fetch;
 let requests=0;
 globalThis.fetch=async()=>{requests++;return new Response(null,{status:429,headers:{'Retry-After':'60'}})};
 try{
  const url=new URL('https://commons.wikimedia.org/w/api.php');
  await assert.rejects(
   wikimedia.fetchWikimediaJson(url),
   error=>error instanceof wikimedia.WikimediaDeferredError&&
    error.retryAt.getTime()>=Date.now()+59000
  );
  assert.equal(requests,1);
 }finally{globalThis.fetch=originalFetch}
});

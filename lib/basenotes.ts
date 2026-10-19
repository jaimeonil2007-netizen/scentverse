export async function searchBasenotes(brand:string,name:string){
 const q=encodeURIComponent(`site:basenotes.com/fragrances/ "${brand} ${name}"`);
 const r=await fetch(`https://www.bing.com/search?format=rss&q=${q}`,{signal:AbortSignal.timeout(8000)});
 if(!r.ok)return [];
 const xml=await r.text();
 return [...xml.matchAll(/<link>(https:\/\/(?:www\.)?basenotes\.com\/fragrances\/[^<]+)<\/link>/g)]
 .slice(0,3).map(m=>m[1].replace(/&amp;/g,'&'));
}

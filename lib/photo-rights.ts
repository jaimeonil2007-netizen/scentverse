const permittedNames=new Set([
 'cc0','cc0 1.0','cc by 3.0','cc by 4.0',
 'cc by-sa 3.0','cc by-sa 4.0','public domain','public domain mark 1.0'
]);

export function isPermittedLicenseName(name:string|null){
 return Boolean(name&&permittedNames.has(name.trim().toLowerCase()));
}

export function isVerifiedAutoPublishLicense(name:string|null,licenseUrl:string|null){
 if(!name||!licenseUrl)return false;
 let url:URL;
 try{url=new URL(licenseUrl)}catch{return false}
 if(url.protocol!=='https:'||
  !['creativecommons.org','www.creativecommons.org'].includes(url.hostname))return false;
 const path=url.pathname.toLowerCase().replace(/\/+$/,'');
 const normalized=name.trim().toLowerCase();
 if(normalized==='cc0'||normalized==='cc0 1.0')
  return path==='/publicdomain/zero/1.0';
 if(normalized==='public domain mark 1.0')
  return path==='/publicdomain/mark/1.0';
 const match=normalized.match(/^cc by(-sa)? (3|4)\.0$/);
 return Boolean(match&&path===`/licenses/by${match[1]||''}/${match[2]}.0`);
}

export function hasConsistentLicenseReference(name:string|null,licenseUrl:string|null){
 if(!isPermittedLicenseName(name))return false;
 if(!licenseUrl)return name?.trim().toLowerCase()==='public domain';
 return isVerifiedAutoPublishLicense(name,licenseUrl);
}

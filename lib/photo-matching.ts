const concentrationAliases:Record<string,string[]>={
 'eau de parfum':['eau de parfum','edp'],
 'eau de toilette':['eau de toilette','edt'],
 'eau de cologne':['eau de cologne','edc'],
 'parfum':['parfum','extrait','pure perfume']
};

function normalize(value:string){
 return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  .replace(/[^a-z0-9]+/g,' ').trim();
}

function containsPhrase(text:string,expected:string){
 const phrase=normalize(expected);
 return Boolean(phrase)&&` ${normalize(text)} `.includes(` ${phrase} `);
}

export function concentrationTypes(value:string){
 const normalized=` ${normalize(value)} `;
 const found=new Set<string>();
 for(const [type,aliases] of Object.entries(concentrationAliases)){
  if(aliases.some(alias=>normalized.includes(` ${normalize(alias)} `)))found.add(type);
 }
 if(found.has('eau de parfum'))found.delete('parfum');
 return found;
}

export function hasExactProductEvidence(brand:string,name:string,text:string){
 return containsPhrase(text,brand)&&containsPhrase(text,name);
}

export function hasCompatibleConcentration(concentration:string,text:string){
 const expected=concentrationTypes(concentration);
 const found=concentrationTypes(text);
 return found.size===0||found.size===1&&(!expected.size||found.has([...expected][0]));
}

export function hasExactBottleDescription(brand:string,name:string,concentration:string,description:string){
 const expected=concentrationTypes(concentration);
 const found=concentrationTypes(description);
 return expected.size===1&&found.size===1&&found.has([...expected][0])&&
  hasExactProductEvidence(brand,name,description)&&/\b(bottle|flacon)\b/i.test(description);
}

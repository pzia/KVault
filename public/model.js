export function emptyVault(){return{schema:4,updatedAt:new Date().toISOString(),kobo:null,purchases:[],purchasesFetchedAt:null,bookStates:{},settings:{language:"",librarySort:"title-asc",catalogSort:"publication-desc",statsRanking:"count",apiProjectionEnabled:false,apiAcquisitionEnabled:false}}}
export function stableBookKey(b){return b?.revisionId||b?.productId||b?.isbn||`${norm(b?.title)}|${(b?.authors||[]).map(norm).join("|")}`}
export function norm(s){return String(s||"").normalize("NFD").replace(/\p{Diacritic}/gu,"").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim()}
export function filterPurchases(items,{search="",language="",mediaType=""}={}){const q=norm(search);return(items||[]).filter(b=>{const hay=norm(`${b.title} ${b.subtitle||""} ${(b.authors||[]).join(" ")}`);return(!q||hay.includes(q))&&(!language||langEq(b.language,language))&&(!mediaType||b.mediaType===mediaType)})}
export function languageOptions(items){return[...new Set((items||[]).map(x=>String(x.language||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b))}

export function publicationYear(value){const s=String(value||"").trim();if(!s)return"";const m=s.match(/\b(1[0-9]{3}|20[0-9]{2}|21[0-9]{2})\b/);return m?m[1]:""}
function publicationTime(value){const year=publicationYear(value);if(!year)return null;const d=Date.parse(String(value||""));return Number.isFinite(d)?d:Date.UTC(Number(year),0,1)}
export function sortBooks(items,sort="title-asc"){
  const out=[...(items||[])];
  const title=(b)=>String(b?.title||"");
  const author=(b)=>String(b?.authors?.[0]||"");
  const alpha=(a,b,key)=>key(a).localeCompare(key(b),"fr",{sensitivity:"base",numeric:true});
  const byPublication=(a,b,dir)=>{const ta=publicationTime(a?.publicationDate),tb=publicationTime(b?.publicationDate);if(ta===null&&tb===null)return alpha(a,b,title);if(ta===null)return 1;if(tb===null)return-1;if(ta!==tb)return dir*(ta-tb);return alpha(a,b,title)};
  if(sort==="publication-desc")return out.sort((a,b)=>byPublication(a,b,-1));
  if(sort==="publication-asc")return out.sort((a,b)=>byPublication(a,b,1));
  if(sort==="author-asc")return out.sort((a,b)=>alpha(a,b,author)||alpha(a,b,title));
  if(sort==="acquired-desc")return out.sort((a,b)=>(Date.parse(b?.acquiredAt||0)||0)-(Date.parse(a?.acquiredAt||0)||0)||alpha(a,b,title));
  return out.sort((a,b)=>alpha(a,b,title));
}

export function authorMatches(query,candidate){
  const q=norm(query),c=norm(candidate);if(!q||!c)return false;if(q===c)return true;
  const qt=q.split(" ").filter(Boolean),ct=c.split(" ").filter(Boolean);
  if(qt.length<2||ct.length<2||qt.length!==ct.length)return false;
  return fuzzyTokenBagEqual(qt,ct);
}
function fuzzyTokenBagEqual(a,b){
  const used=new Set();
  for(const token of a){let best=-1,bestDistance=Infinity;for(let i=0;i<b.length;i++){if(used.has(i))continue;const d=tokenDistance(token,b[i]);if(d<bestDistance){best=i;bestDistance=d}}if(best<0||bestDistance>allowedTokenDistance(token,b[best]))return false;used.add(best)}
  return true;
}
function tokenDistance(a,b){if(a===b)return 0;return levenshtein(a,b)}
function allowedTokenDistance(a,b){const n=Math.max(a.length,b.length);return n>=5?1:0}
function levenshtein(a,b){const prev=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){let left=i,diag=i-1;for(let j=1;j<=b.length;j++){const up=prev[j],next=a[i-1]===b[j-1]?diag:Math.min(diag,up,left)+1;prev[j]=next;diag=up;left=next}}return prev[b.length]}
function authorSegments(value){const raw=String(value||"").trim();if(!raw)return[];const split=raw.split(/\s*(?:;|\+|&|\/|\band\b|\bet\b)\s*/i).map(x=>x.trim()).filter(Boolean);return split.length?split:[raw]}
function anyAuthorMatch(query,authors){return(authors||[]).flatMap(authorSegments).some(a=>authorMatches(query,a))}

export function ownedMatch(owned,candidate){const ids=new Set([candidate.revisionId,candidate.productId,candidate.isbn].filter(Boolean).map(norm));for(const b of owned||[]){if([b.revisionId,b.productId,b.isbn].filter(Boolean).some(x=>ids.has(norm(x))))return true;const sameTitle=norm(b.title)===norm(candidate.title);if(!sameTitle)continue;const aa=(b.authors||[]),ca=(candidate.authors||[]);if(!aa.length||!ca.length||aa.some(a=>ca.some(c=>authorMatches(a,c))))return true}return false}
export function isBookMarkedRead(bookStates,book){let best=null;for(const entry of Object.values(bookStates||{})){if(!entry?.book||!ownedMatch([entry.book],book))continue;if(!best||Date.parse(entry.updatedAt||0)>Date.parse(best.updatedAt||0))best=entry}return best?.state==="read"}
export function setBookReadState(bookStates,book,read,updatedAt=new Date().toISOString()){const states={...(bookStates||{})};const matching=Object.entries(states).filter(([,entry])=>entry?.book&&ownedMatch([entry.book],book)).sort((a,b)=>Date.parse(b[1]?.updatedAt||0)-Date.parse(a[1]?.updatedAt||0));const key=matching[0]?.[0]||`book:${stableBookKey(book)}`;states[key]={state:read?"read":"unmarked",updatedAt,book:bookSnapshot(book)};return states}
export function compareCatalog(owned,catalog,{mode="author",query="",language=""}={},bookStates={}){const relevant=dedupe((catalog||[]).filter(b=>{if(language&&!langEq(b.language,language))return false;if(mode==="author")return !norm(query)||anyAuthorMatch(query,b.authors);if(mode==="series")return seriesMatches(query,b.series);if(mode==="free")return freeSearchMatches(query,b);return true}));const ownedItems=[],readItems=[],missing=[];for(const b of relevant){if(ownedMatch(owned,b))ownedItems.push(b);else if(isBookMarkedRead(bookStates,b))readItems.push(b);else missing.push(b)}return{catalog:relevant,owned:ownedItems,read:readItems,missing,ownedCount:ownedItems.length,readCount:readItems.length,missingCount:missing.length,mode,query,language}}
export function compareAuthor(owned,catalog,author,language="",bookStates={}){return compareCatalog(owned,catalog,{mode:"author",query:author,language},bookStates)}
function seriesMatches(query,series){const q=norm(query),s=norm(series);if(!q||!s)return false;if(q===s)return true;const shorter=Math.min(q.length,s.length);return shorter>=5&&(s.includes(q)||q.includes(s))}
export function parseFreeSearch(query){
  const raw=String(query||"");const phrases=[];const remainder=raw.replace(/"([^"\n]+)"/g,(_,value)=>{const p=norm(value);if(p)phrases.push(p);return" "});
  const terms=norm(remainder).split(" ").filter(Boolean);return{phrases,terms,hasExact:phrases.length>0};
}
export function freeSearchMatches(query,book){
  const parsed=parseFreeSearch(query);if(!parsed.hasExact)return true;
  const fields=[book?.title,book?.subtitle,...(book?.authors||[]),book?.series,book?.publisher,book?.description].map(norm).filter(Boolean);
  const hay=fields.join(" ");
  return parsed.phrases.every(p=>fields.some(field=>field.includes(p)))&&parsed.terms.every(t=>hay.includes(t));
}
export function filterComparison(comparison,filter="all"){if(!comparison)return[];if(filter==="owned")return comparison.owned||[];if(filter==="read")return comparison.read||[];if(filter==="missing")return comparison.missing||[];return comparison.catalog||[]}
export function dedupe(items){const m=new Map();for(const b of items||[]){const k=stableBookKey(b);if(!m.has(k))m.set(k,b)}return[...m.values()]}

export function topAuthors(items,{language="",mediaType="",limit=20,ranking="count"}={}){
  const filtered=filterPurchases(items,{language,mediaType});const groups=new Map();
  for(const book of filtered){
    const rating=validAverageRating(book?.averageRating);const contribution=rating===null?0:rating/5;
    const seen=new Set();for(const author of book.authors||[]){const name=String(author||"").trim();if(!name)continue;const key=canonicalAuthorKey(name);if(!key||seen.has(key))continue;seen.add(key);let g=groups.get(key);if(!g){g={key,count:0,variants:new Map(),ratedCount:0,ratingSum:0,weightedScore:0};groups.set(key,g)}g.count+=1;if(rating!==null){g.ratedCount+=1;g.ratingSum+=rating;g.weightedScore+=contribution}g.variants.set(name,(g.variants.get(name)||0)+1)}
  }
  let rows=[...groups.values()].map(g=>({key:g.key,count:g.count,name:preferredAuthorName(g.variants),ratedCount:g.ratedCount,averageRating:g.ratedCount?g.ratingSum/g.ratedCount:null,weightedScore:Math.round(g.weightedScore*1e6)/1e6}));
  rows.sort((a,b)=>ranking==="weighted"?(b.weightedScore-a.weightedScore||b.count-a.count||a.name.localeCompare(b.name,"fr",{sensitivity:"base"})):(b.count-a.count||b.weightedScore-a.weightedScore||a.name.localeCompare(b.name,"fr",{sensitivity:"base"})));
  const n=Number(limit);if(Number.isFinite(n)&&n>0)rows=rows.slice(0,n);return rows
}
function validAverageRating(value){const n=Number(value);return Number.isFinite(n)&&n>0&&n<=5?n:null}
export function canonicalAuthorKey(name){const tokens=norm(name).split(" ").filter(Boolean);return tokens.sort().join("|")}
function preferredAuthorName(variants){return[...variants.entries()].sort((a,b)=>b[1]-a[1]||(a[0].includes(",")?1:0)-(b[0].includes(",")?1:0)||a[0].localeCompare(b[0],"fr",{sensitivity:"base"}))[0]?.[0]||"Auteur inconnu"}

export function mergeVaults(remote,local){const r=remote||emptyVault(),l=local||emptyVault();const books=new Map();for(const b of[...(r.purchases||[]),...(l.purchases||[])]){const k=stableBookKey(b);books.set(k,mergeBookData(books.get(k),b))}const remoteTime=Date.parse(r.updatedAt||0),localTime=Date.parse(l.updatedAt||0);const newest=localTime>=remoteTime?l:r;return{schema:4,updatedAt:new Date().toISOString(),kobo:newest.kobo||r.kobo||l.kobo||null,purchases:[...books.values()],purchasesFetchedAt:newest.purchasesFetchedAt||r.purchasesFetchedAt||l.purchasesFetchedAt||null,bookStates:mergeBookStates(r.bookStates,l.bookStates),settings:{...(r.settings||{}),...(l.settings||{})}}}
function mergeBookData(a,b){if(!a)return b;if(!b)return a;const merged={...a,...b};for(const key of["averageRating","ratingCount"]){const bv=b?.[key],av=a?.[key];if((bv===null||bv===undefined||bv==="")&&av!==null&&av!==undefined&&av!=="")merged[key]=av}return merged}

export function toCsv(items){const cols=["title","authors","isbn","language","series","publisher","publicationDate","publicationYear","averageRating","ratingCount","mediaType","archived","readStatus","revisionId","productId"];const esc=v=>`"${String(v??"").replaceAll('"','""')}"`;return[cols.map(esc).join(","),...(items||[]).map(b=>cols.map(c=>esc(c==="authors"?(b.authors||[]).join("; "):c==="publicationYear"?publicationYear(b.publicationDate):b[c])).join(","))].join("\n")}
function mergeBookStates(a,b){const out={...(a||{})};for(const[key,value]of Object.entries(b||{})){const prev=out[key];if(!prev||Date.parse(value?.updatedAt||0)>=Date.parse(prev?.updatedAt||0))out[key]=value}return out}
function bookSnapshot(b){return{revisionId:b?.revisionId||"",productId:b?.productId||"",isbn:b?.isbn||"",title:b?.title||"",authors:Array.isArray(b?.authors)?b.authors:[],language:b?.language||"",koboUrl:b?.koboUrl||"",publicationDate:b?.publicationDate||""}}
function langEq(a,b){const x=String(a||"").toLowerCase().split(/[-_]/)[0],y=String(b||"").toLowerCase().split(/[-_]/)[0];return x===y}

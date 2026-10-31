const te = new TextEncoder();
const td = new TextDecoder();
const ITERATIONS = 350_000;

export function normalizeUid(uid){return String(uid||"").normalize("NFKC").trim().toLowerCase()}
export async function sha256Hex(text){const d=await crypto.subtle.digest("SHA-256",te.encode(text));return hex(new Uint8Array(d))}
export function randomSalt(){const b=new Uint8Array(16);crypto.getRandomValues(b);return b64url(b)}
export function randomDeviceSecret(){const b=new Uint8Array(32);crypto.getRandomValues(b);return b64url(b)}

export async function deriveVaultKeys(uid,password,saltB64){
  const material=await crypto.subtle.importKey("raw",te.encode(password),"PBKDF2",false,["deriveBits"]);
  const salt=fromB64url(saltB64);
  const bits=await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt,iterations:ITERATIONS},material,512);
  const bytes=new Uint8Array(bits);
  const encBytes=bytes.slice(0,32),authBytes=bytes.slice(32,64);
  const encKeyRaw=b64url(encBytes);
  const encKey=await importVaultKey(encKeyRaw);
  const uidHash=await sha256Hex(normalizeUid(uid));
  const authSecret=b64url(authBytes);
  encBytes.fill(0); authBytes.fill(0); bytes.fill(0);
  return {encKey,encKeyRaw,authSecret,uidHash};
}

export async function importVaultKey(rawB64){
  return crypto.subtle.importKey("raw",fromB64url(rawB64),{name:"AES-GCM"},false,["encrypt","decrypt"]);
}

export async function encryptVault(value,key,uidHash){
  const iv=new Uint8Array(12);crypto.getRandomValues(iv);
  const aad=te.encode(`kobo-library-vault:v1:${uidHash}`);
  const plain=te.encode(JSON.stringify(value));
  const cipher=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:aad},key,plain);
  return `v1.${b64url(iv)}.${b64url(new Uint8Array(cipher))}`;
}

export async function decryptVault(blob,key,uidHash){
  const [v,ivS,cS]=String(blob||"").split(".");if(v!=="v1"||!ivS||!cS)throw new Error("Format de coffre inconnu");
  const aad=te.encode(`kobo-library-vault:v1:${uidHash}`);
  try{const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:fromB64url(ivS),additionalData:aad},key,fromB64url(cS));return JSON.parse(td.decode(plain))}
  catch{throw new Error("Mot de passe incorrect ou coffre corrompu")}
}

// Session persistante v2 : le mot de passe n'est jamais stocké. On chiffre le
// matériel dérivé du coffre avec un secret aléatoire propre à ce navigateur.
// Le secret appareil est stocké séparément de l'enveloppe IndexedDB pour éviter
// de dépendre de la sérialisation de CryptoKey, peu fiable sur certains Firefox.
export async function encryptDeviceSession(value,deviceSecret,uidHash){
  const key=await crypto.subtle.importKey("raw",fromB64url(deviceSecret),{name:"AES-GCM"},false,["encrypt"]);
  const iv=new Uint8Array(12);crypto.getRandomValues(iv);
  const aad=te.encode(`kobo-library-vault:device-session:v2:${uidHash}`);
  const plain=te.encode(JSON.stringify(value));
  const cipher=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:aad},key,plain);
  return `v2.${b64url(iv)}.${b64url(new Uint8Array(cipher))}`;
}

export async function decryptDeviceSession(blob,deviceSecret,uidHash){
  const [v,ivS,cS]=String(blob||"").split(".");if(v!=="v2"||!ivS||!cS)throw new Error("Format de session locale inconnu");
  const key=await crypto.subtle.importKey("raw",fromB64url(deviceSecret),{name:"AES-GCM"},false,["decrypt"]);
  const aad=te.encode(`kobo-library-vault:device-session:v2:${uidHash}`);
  try{const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:fromB64url(ivS),additionalData:aad},key,fromB64url(cS));return JSON.parse(td.decode(plain))}
  catch{throw new Error("Session locale illisible")}
}

function hex(b){return [...b].map(x=>x.toString(16).padStart(2,"0")).join("")}
export function b64url(bytes){let s="";for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s).replaceAll("+","-").replaceAll("/","_").replace(/=+$/g,"")}
export function fromB64url(s){s=String(s).replaceAll("-","+").replaceAll("_","/");s+="=".repeat((4-s.length%4)%4);const raw=atob(s);const b=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)b[i]=raw.charCodeAt(i);return b}

import { existsSync, lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export type R2Settings = {endpoint:string; mediaBucket:string; outputBucket:string; mediaAccessKeyId:string; mediaSecretAccessKey:string; outputAccessKeyId:string; outputSecretAccessKey:string};
export type PrivateSettings = {dataDirectory:string; ownerId:string; passwordHash:string|null; origins:string[]; cloudEnabled:boolean; maxCloudStarts:1; awsProfile:string; awsRoleArn:string|null; inputBucket:string|null; renderBucket:string|null; serveUrl:string|null; r2:R2Settings|null};
export const FUNCTION_NAME="remotion-render-4-0-535-mem2048mb-disk2048mb-120sec";
export const REMOTION_VERSION="4.0.535";
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const string=(value:unknown)=>typeof value==="string"?value.trim():"";
export function readPrivateSettings(filename:string, dataDirectory:string):PrivateSettings {
 let raw:Record<string,unknown>={};
 if(existsSync(filename)) {
  const metadata=lstatSync(filename);
  if(!metadata.isFile()||metadata.isSymbolicLink()||(metadata.mode&0o077)!==0||(process.getuid&&metadata.uid!==process.getuid())) throw new Error("Unsafe private configuration permissions");
  try {raw=object(JSON.parse(readFileSync(filename,"utf8")));} catch {throw new Error("Invalid private configuration");}
 }
 const origins=Array.isArray(raw.origins)?raw.origins.map(string):["http://127.0.0.1:3002","http://localhost:3002"];
 if(origins.length===0||origins.some(origin=>{try{const url=new URL(origin);return url.origin!==origin||!["https:","http:"].includes(url.protocol)||(url.protocol==="http:"&&!["localhost","127.0.0.1"].includes(url.hostname));}catch{return true;}})) throw new Error("Invalid private origins");
 let r2:R2Settings|null=null;
 if(raw.r2) {
  const value=object(raw.r2);
  const endpoint=string(value.endpoint);
  if(!/^https:\/\/[a-f0-9]{32}(?:\.eu)?\.r2\.cloudflarestorage\.com\/?$/.test(endpoint)) throw new Error("Invalid private R2 endpoint");
  r2={endpoint,mediaBucket:"lyrica-private-media",outputBucket:"lyrica-private-renders",mediaAccessKeyId:string(value.mediaAccessKeyId),mediaSecretAccessKey:string(value.mediaSecretAccessKey),outputAccessKeyId:string(value.outputAccessKeyId),outputSecretAccessKey:string(value.outputSecretAccessKey)};
  if(Object.values(r2).some(v=>!v)) throw new Error("Incomplete private R2 configuration");
 }
 const role=string(raw.awsRoleArn)||null;
 if(role&&!/^arn:aws:iam::\d{12}:role\/lyrica-remotion-client-pilot$/.test(role)) throw new Error("Invalid pilot role");
 const url=string(raw.serveUrl)||null;
 if(url&&!/^https:\/\/[a-z0-9]+\.cloudfront\.net\/sites\/lyrica-4-0-535-pilot\/index\.html$/.test(url)) throw new Error("Invalid reviewed renderer URL");
 const cloudEnabled=raw.cloudEnabled===true;
 if(cloudEnabled&&(!r2||!role||!url||!string(raw.inputBucket)||!string(raw.renderBucket))) throw new Error("Incomplete cloud configuration");
 return {dataDirectory,ownerId:"owner",passwordHash:string(raw.passwordHash)||null,origins,cloudEnabled,maxCloudStarts:1,awsProfile:"lyrica-pilot-operator",awsRoleArn:role,inputBucket:string(raw.inputBucket)||null,renderBucket:string(raw.renderBucket)||null,serveUrl:url,r2};
}
export function getSettings():PrivateSettings {
 const dataDirectory=process.env.LYRICA_PRIVATE_DATA_DIR??path.join(process.env.LYRICA_DATA??path.join(homedir(),"Library","Application Support","Lyrica"),"private");
 const filename=process.env.LYRICA_PRIVATE_CONFIG_FILE??path.join(dataDirectory,"render-config.json");
 return readPrivateSettings(filename,dataDirectory);
}

import path from "node:path";
import {PrivateMedia} from "./media";
import {getStore,PrivateError} from "./server";
import {mediaStorage} from "./r2";
import type {Actor} from "./store";
import {assetReferences,assetFilename} from "./sources";
import type {VideoConfig} from "../../types/lyrics";
import {open,lstat,rm} from "node:fs/promises";
import {validMediaHeader} from "./media-header";
export function getMedia():PrivateMedia {return new PrivateMedia(getStore(),path.join(process.cwd(),"tmp","lyrica"),mediaStorage(),mediaStorage(true));}
export async function registerOwnedMedia(actor:Actor,filename:string,contentType:string,maximumBytes:number,scope:"media"|"exports"="media"){
 const source=path.join(process.cwd(),"tmp","lyrica",ownedAssetFilename(`/api/audio/${filename}`));
 const metadata=await lstat(source);if(!metadata.isFile()||metadata.isSymbolicLink()||metadata.size>maximumBytes)throw new PrivateError(400,"Ungültige Mediendatei.");
 const handle=await open(source,"r");let bytes:Buffer;try{bytes=Buffer.alloc(32);const read=await handle.read(bytes,0,32,0);bytes=bytes.subarray(0,read.bytesRead);}finally{await handle.close();}
 if(!validMediaHeader(bytes,contentType)){await rm(source,{force:true});throw new PrivateError(400,"Dateiinhalt passt nicht zum Medientyp.");}
 return getMedia().register(actor,filename,contentType,maximumBytes,scope);
}
export async function resolveOwnedMedia(actor:Actor,filename:string):Promise<string> {try{return await getMedia().resolve(actor,filename);}catch{throw new PrivateError(404,"Nicht gefunden.");}}
export function ownedAssetFilename(url:string):string {try{return assetFilename(url);}catch{throw new PrivateError(400,"Nur private Projektmedien sind erlaubt.");}}
export async function validateOwnedSources(actor:Actor,config:VideoConfig):Promise<void> {
 let refs;try{refs=assetReferences(config);}catch{throw new PrivateError(400,"Nur private Projektmedien sind erlaubt.");}
 for(const ref of refs){
  const media=getStore().media(actor,ref.filename);if(!media)throw new PrivateError(404,"Nicht gefunden.");
  const valid=ref.role==="audio"?media.contentType.startsWith("audio/"):ref.role==="logo"?media.contentType.startsWith("image/"):media.contentType.startsWith(config.style.bgType==="video"?"video/":"image/");
  if(!valid)throw new PrivateError(400,"Ungültiger Medientyp.");await resolveOwnedMedia(actor,ref.filename);
 }
}

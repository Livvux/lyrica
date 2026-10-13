import {lstat,mkdir,readFile,writeFile,rm} from "node:fs/promises";
import path from "node:path";
import type {PrivateStore,Actor,MediaRecord} from "./store";
export interface MediaStorage {put(key:string,bytes:Buffer,contentType:string):Promise<void>;read(key:string,maximumBytes:number):Promise<Buffer>;delete(key:string):Promise<void>;}
export const MAX_RETAINED_BYTES=512*1024*1024;
export class PrivateMedia {
 constructor(private store:PrivateStore,private cache:string,private storage?:MediaStorage,private outputStorage?:MediaStorage){}
 private filename(name:string):string {if(!/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(name))throw new Error("Nicht gefunden.");return path.join(this.cache,name);}
 async register(actor:Actor,filename:string,contentType:string,maximumBytes=100*1024*1024,scope:"media"|"exports"="media"):Promise<MediaRecord> {
  const source=this.filename(filename);const info=await lstat(source);
  if(!info.isFile()||info.isSymbolicLink()||info.size<=0||info.size>maximumBytes)throw new Error("Ungültige Mediendatei.");
  if(contentType==="image/svg+xml"||/\.svg$/i.test(filename))throw new Error("Für private Logos bitte PNG, JPEG oder WebP verwenden.");
  const storage=scope==="exports"?this.outputStorage:this.storage;
  const key=storage?`${scope}/${actor.ownerId}/${actor.projectId}/${filename}`:null;
  const record=this.store.transaction(()=>{
   if(this.store.retainedMediaBytes()+info.size>MAX_RETAINED_BYTES)throw new Error("Privater Speicher voll.");
   return this.store.registerMedia(actor,{filename,contentType,size:info.size,objectKey:key});
  });
  if(key&&storage)try{await storage.put(key,await readFile(source),contentType);}catch{
   try{await storage.delete(key);}catch{this.store.markMediaCleanupPending(actor,filename);throw new Error("Upload und Bereinigung müssen geprüft werden.");}
   this.store.removeMedia(actor,filename);await rm(source,{force:true});throw new Error("Privater Upload fehlgeschlagen.");
  }
  return record;
 }
 async retryPendingCleanup():Promise<void>{
  for(const record of this.store.pendingMediaCleanup().slice(0,10)){
   const scope=record.objectKey?.startsWith("exports/")?"exports":"media";
   if(record.objectKey!==`${scope}/${record.ownerId}/${record.projectId}/${record.filename}`)continue;
   const storage=scope==="exports"?this.outputStorage:this.storage;if(!storage)continue;
   try{await storage.delete(record.objectKey);await rm(this.filename(record.filename),{force:true});this.store.removeMedia(record,record.filename);}catch{/* Retain quota and retry on a later request. */}
  }
 }
 async resolve(actor:Actor,filename:string):Promise<string> {
  const record=this.store.media(actor,filename);if(!record)throw new Error("Nicht gefunden.");
  const destination=this.filename(filename);
  try{const info=await lstat(destination);if(!info.isFile()||info.isSymbolicLink()||info.size!==record.size)throw new Error("Ungültiger Mediencache.");return destination;}
  catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  const storage=record.objectKey?.startsWith("exports/")?this.outputStorage:this.storage;
  if(!storage||!record.objectKey)throw new Error("Nicht gefunden.");
  const bytes=await storage.read(record.objectKey,record.size);if(bytes.length!==record.size)throw new Error("Ungültige Mediendatei.");
  await mkdir(this.cache,{recursive:true,mode:0o700});await writeFile(destination,bytes,{mode:0o600});return destination;
 }
}

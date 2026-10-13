export interface MultipartCleanup {
 list(prefix:string,cursor?:string):Promise<{uploads:{key:string;id:string}[];next?:string}>;
 abort(key:string,id:string):Promise<void>;
 delete(key:string):Promise<void>;
}
export async function cleanupMultipartOutput(key:string,adapter:MultipartCleanup):Promise<void> {
 let cursor:string|undefined;
 do{const page=await adapter.list(key,cursor);for(const upload of page.uploads)if(upload.key===key)await adapter.abort(key,upload.id);cursor=page.next;}while(cursor);
 await adapter.delete(key);
}

export async function readBoundedBody(request:Request,maximumBytes:number):Promise<Buffer> {
 const declared=Number(request.headers.get("content-length")??0);
 if(declared>maximumBytes)throw new Error("Anfrage zu groß.");
 const reader=request.body?.getReader();if(!reader)return Buffer.alloc(0);
 const chunks:Buffer[]=[];let size=0;
 try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maximumBytes){await reader.cancel();throw new Error("Anfrage zu groß.");}chunks.push(Buffer.from(value));}}
 finally{reader.releaseLock();}
 return Buffer.concat(chunks,size);
}
export async function privateFormData(request:Request,maximumBytes:number):Promise<FormData> {
 const bytes=await readBoundedBody(request,maximumBytes+1024*1024);
 return new Response(new Uint8Array(bytes),{headers:{"Content-Type":request.headers.get("content-type")??""}}).formData();
}

import {createServer} from "node:http";
import {createReadStream} from "node:fs";
import {lstat,realpath} from "node:fs/promises";
import {randomBytes} from "node:crypto";
import path from "node:path";
import {parseByteRange} from "../http-range";

/** Job-local origin. Never expose uploaded render assets through Remotion's LAN server. */
export async function servePrivateBundle(directory:string):Promise<{url:string;close:()=>Promise<void>}> {
 const root=await realpath(directory);const token=randomBytes(32).toString("hex");
 const prefix=`/${token}/`;const cookie=`lyrica-bundle=${token}`;
 const server=createServer(async(req,res)=>{
  try {
   if(req.method!=="GET"&&req.method!=="HEAD"){res.writeHead(405);res.end();return;}
   const url=new URL(req.url??"/","http://127.0.0.1");
   const hasToken=url.pathname.startsWith(prefix);
   if(!hasToken&&!req.headers.cookie?.split(/;\s*/).includes(cookie)){res.writeHead(404);res.end();return;}
   const relative=decodeURIComponent(hasToken?url.pathname.slice(prefix.length):url.pathname.slice(1))||"index.html";
   const source=path.resolve(root,relative);
   if(!source.startsWith(root+path.sep)){res.writeHead(404);res.end();return;}
   const info=await lstat(source);const actual=await realpath(source);
   if(!info.isFile()||info.isSymbolicLink()||!actual.startsWith(root+path.sep)){res.writeHead(404);res.end();return;}
   const range=parseByteRange(typeof req.headers.range==="string"?req.headers.range:null,info.size);
   if(range==="unsatisfiable"){res.writeHead(416,{"Content-Range":`bytes */${info.size}`});res.end();return;}
   const types:Record<string,string>={".svg":"image/svg+xml",".jpeg":"image/jpeg",".gif":"image/gif",".avif":"image/avif",".woff":"font/woff",".woff2":"font/woff2",".ttf":"font/ttf",".m4a":"audio/mp4",".aac":"audio/aac",".ogg":"audio/ogg",".flac":"audio/flac",".html":"text/html",".js":"text/javascript",".css":"text/css",".jpg":"image/jpeg",".png":"image/png",".webp":"image/webp",".wav":"audio/wav",".mp3":"audio/mpeg",".mp4":"video/mp4",".webm":"video/webm",".json":"application/json"};
   res.writeHead(range?206:200,{"Content-Type":types[path.extname(source).toLowerCase()]??"application/octet-stream","Content-Length":range?range.end-range.start+1:info.size,"Accept-Ranges":"bytes","Cache-Control":"no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff",...(hasToken?{"Set-Cookie":`${cookie}; HttpOnly; SameSite=Strict; Path=/`}:{}),...(range?{"Content-Range":`bytes ${range.start}-${range.end}/${info.size}`}:{})});
   if(req.method==="HEAD"){res.end();return;}
   const stream=createReadStream(source,range??undefined);stream.on("error",()=>res.destroy());res.on("close",()=>stream.destroy());stream.pipe(res);
  }catch{if(!res.headersSent)res.writeHead(404);res.end();}
 });
 await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
 const address=server.address();if(!address||typeof address==="string")throw new Error("Private bundle server unavailable");
 return {url:`http://127.0.0.1:${address.port}${prefix}index.html`,close:()=>new Promise<void>((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();})};
}

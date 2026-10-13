import {requireActor,PrivateError} from "../../../../../lib/private-render/server";
import {getCloudJobs} from "../../../../../lib/private-render/cloud-service";
import {cloudFailure,privateHeaders} from "../../../../../lib/private-render/cloud-http";
export const runtime="nodejs";
type Context={params:Promise<{id:string}>};
export async function HEAD(request:Request,{params}:Context){try{const actor=requireActor(request),{id}=await params;const job=getCloudJobs().status(actor,id);if(!job.downloadReady)throw new PrivateError(409,"Download noch nicht bereit.");return new Response(null,{status:204,headers:privateHeaders});}catch(error){return cloudFailure(error);}}
export async function GET(request:Request,{params}:Context){try{const actor=requireActor(request),{id}=await params;const url=await getCloudJobs().download(actor,id);return new Response(null,{status:307,headers:{...privateHeaders,Location:url}});}catch(error){return cloudFailure(error);}}

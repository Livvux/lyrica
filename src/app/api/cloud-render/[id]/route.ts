import {after} from "next/server";
import {requireActor} from "../../../../lib/private-render/server";
import {getCloudJobs} from "../../../../lib/private-render/cloud-service";
import {cloudFailure,privateHeaders} from "../../../../lib/private-render/cloud-http";
export const runtime="nodejs";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){try{const actor=requireActor(request),{id}=await params,jobs=getCloudJobs();const job=jobs.status(actor,id);after(()=>jobs.advance(id));return Response.json(job,{headers:privateHeaders});}catch(error){return cloudFailure(error);}}

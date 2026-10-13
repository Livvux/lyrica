import {after} from "next/server";
import {getSettings} from "../../../lib/private-render/settings";
import {requireActor,PrivateError,getStore} from "../../../lib/private-render/server";
import {readBoundedBody} from "../../../lib/private-render/body";
import {VideoConfigSchema} from "../../../lib/private-render/schema";
import {validateOwnedSources} from "../../../lib/private-render/owned-media";
import {getCloudJobs} from "../../../lib/private-render/cloud-service";
import {cloudFailure,privateHeaders} from "../../../lib/private-render/cloud-http";
export const runtime="nodejs";
export async function POST(request:Request){
 try{
  const actor=requireActor(request,true);if(!getSettings().cloudEnabled)throw new PrivateError(503,"Cloud-Export ist noch nicht freigeschaltet.");
  if(!getStore().consumeLimit(`cloud-start:${actor.ownerId}`,3,60000))throw new PrivateError(429,"Bitte eine Minute warten.");
  const raw=JSON.parse((await readBoundedBody(request,50*1024)).toString("utf8")) as {config?:unknown;requestKey?:unknown};
  const parsed=VideoConfigSchema.safeParse(raw.config);if(!parsed.success||typeof raw.requestKey!=="string")throw new PrivateError(400,"Ungültige Video-Konfiguration.");
  if(parsed.data.durationInFrames/parsed.data.fps>30||Buffer.byteLength(JSON.stringify(parsed.data))>45*1024)throw new PrivateError(400,"Cloud-Pilot: höchstens 30 Sekunden und 45 KiB Konfiguration.");
  await validateOwnedSources(actor,parsed.data);
  const jobs=getCloudJobs(),job=jobs.enqueue(actor,raw.requestKey,parsed.data as unknown as Record<string,unknown>);
  after(()=>jobs.advance(job.id));return Response.json(job,{status:202,headers:privateHeaders});
 }catch(error){return cloudFailure(error);}
}
export async function GET(request:Request){try{const actor=requireActor(request);if(!getSettings().r2)return Response.json({job:null},{headers:privateHeaders});return Response.json({job:getCloudJobs().current(actor)},{headers:privateHeaders});}catch(error){return cloudFailure(error);}}

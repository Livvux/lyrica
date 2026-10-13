import { getSettings } from "../../../lib/private-render/settings";
import { getStore, ownerFor, requireActor, privateFailure, PrivateError } from "../../../lib/private-render/server";
import { verifyPassword, assertMutationOrigin, cookieValue } from "../../../lib/private-render/auth";
import {getMedia} from "../../../lib/private-render/owned-media";
import {after} from "next/server";
import {readBoundedBody} from "../../../lib/private-render/body";
export const runtime="nodejs";
const headers={"Cache-Control":"private, no-store"};
export async function GET(request:Request) {
 try {
  const settings=getSettings(); const owner=ownerFor(request);
  if(owner)after(()=>getMedia().retryPendingCleanup());
  if(!owner) return Response.json({authenticated:false,configured:Boolean(settings.passwordHash),cloudReady:false},{headers});
  const actor=requireActor(request);
  return Response.json({authenticated:true,configured:true,desktop:Boolean(process.env.LYRICA_TOKEN),...actor,projects:getStore().projects(owner),cloudReady:settings.cloudEnabled,cloudMaxSeconds:30,cloudMaxStarts:getStore().cloudStartsRemaining()},{headers});
 } catch(error){return privateFailure(error);}
}
export async function POST(request:Request) {
 try {
  const settings=getSettings();
  try {assertMutationOrigin(request,settings.origins);} catch {throw new PrivateError(403,"Anfrage nicht erlaubt.");}
  if(!settings.passwordHash) throw new PrivateError(503,"Private Anmeldung noch nicht eingerichtet.");
  if(!getStore().consumeLimit("login",5,60_000)) throw new PrivateError(429,"Bitte eine Minute warten.");
  const text=(await readBoundedBody(request,2048)).toString("utf8");
  const body=JSON.parse(text) as {password?:unknown};
  if(typeof body.password!=="string"||!verifyPassword(body.password,settings.passwordHash)) throw new PrivateError(401,"Anmeldung fehlgeschlagen.");
  const token=getStore().createSession(settings.ownerId,12*60*60*1000);
  const secure=settings.origins.some(x=>x.startsWith("https:"))?"; Secure":"";
  return Response.json({authenticated:true},{headers:{...headers,"Set-Cookie":`lyrica-private=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}`}});
 } catch(error){return privateFailure(error);}
}
export async function PATCH(request:Request) {
 try {
  const actor=requireActor(request,true); const body=JSON.parse((await readBoundedBody(request,2048)).toString("utf8")) as {projectId?:string;name?:string};
  const project=body.name?getStore().createProject(actor.ownerId,body.name):getStore().project(actor.ownerId,body.projectId??"");
  if(!project) throw new PrivateError(404,"Nicht gefunden.");
  return Response.json({project},{headers:{...headers,"Set-Cookie":`lyrica-project=${project.id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`}});
 } catch(error){return privateFailure(error);}
}
export async function DELETE(request:Request) {
 try {requireActor(request,true);getStore().revokeSession(cookieValue(request,"lyrica-private"));
  return Response.json({ok:true},{headers:{...headers,"Set-Cookie":"lyrica-private=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"}});
 } catch(error){return privateFailure(error);}
}

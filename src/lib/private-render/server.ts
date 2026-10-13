import {PrivateStore,type Actor} from "./store";
import {getSettings} from "./settings";
import {authenticate,assertMutationOrigin,cookieValue} from "./auth";

let store:PrivateStore|undefined;
export function getStore():PrivateStore {return store??=new PrivateStore(getSettings().dataDirectory);}
export class PrivateError extends Error {
 constructor(public status:number,message:string){super(message);this.name="PrivateError";}
}
export function ownerFor(request:Request):string|null {
 const settings=getSettings();
 return authenticate(request,getStore(),{ownerId:settings.ownerId,desktopToken:process.env.LYRICA_TOKEN,desktopOrigin:process.env.LYRICA_TOKEN?`http://127.0.0.1:${process.env.LYRICA_PORT??47831}`:undefined});
}
export function requireActor(request:Request, mutation=false):Actor {
 const ownerId=ownerFor(request);
 if(!ownerId) throw new PrivateError(401,"Bitte zuerst privat anmelden.");
 if(mutation) {
  const desktopOrigin=process.env.LYRICA_TOKEN?`http://127.0.0.1:${process.env.LYRICA_PORT??47831}`:null;
  try {assertMutationOrigin(request,[...getSettings().origins,...(desktopOrigin?[desktopOrigin]:[])]);} catch {throw new PrivateError(403,"Anfrage nicht erlaubt.");}
 }
 const id=new URL(request.url).searchParams.get("projectId")??request.headers.get("x-lyrica-project")??cookieValue(request,"lyrica-project");
 const project=id?getStore().project(ownerId,id):getStore().defaultProject(ownerId);
 if(!project) throw new PrivateError(404,"Nicht gefunden.");
 return {ownerId,projectId:project.id};
}
export function privateFailure(error:unknown):Response {
 const known=error instanceof PrivateError;
 return Response.json({error:known?error.message:"Vorgang fehlgeschlagen. Bitte Konfiguration und Anmeldung prüfen."},{status:known?error.status:503,headers:{"Cache-Control":"private, no-store"}});
}

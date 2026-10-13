export type PublicCloudJob={id:string;state:"queued"|"preparing"|"starting"|"rendering"|"cancelling"|"succeeded"|"failed"|"cancelled"|"needs-attention";progress:number;errorCode:string|null;outputBytes:number;cleanupPending:boolean;cancellationConfirmed:boolean;downloadReady:boolean};
type Snapshot={job:PublicCloudJob|null;error:string|null;pending:"start"|"cancel"|"download"|null};
type Fetcher=(url:string,init?:RequestInit)=>Promise<Response>;
export const cloudActive=(job:PublicCloudJob|null)=>Boolean(job&&!["succeeded","failed","cancelled"].includes(job.state));
export class CloudExportClient {
 private snapshot:Snapshot={job:null,error:null,pending:null};
 private listeners=new Set<()=>void>();private refreshing=false;private key:string|null=null;
 constructor(private fetcher:Fetcher=(url,init)=>fetch(url,init)){}
 getSnapshot=()=>this.snapshot;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>this.listeners.delete(listener);};
 private update(changes:Partial<Snapshot>){this.snapshot={...this.snapshot,...changes};for(const listener of this.listeners)listener();}
 async refresh(){
  if(this.refreshing)return;this.refreshing=true;
  try{const response=await this.fetcher("/api/cloud-render",{cache:"no-store"});if(!response.ok)throw new Error();const body=await response.json() as {job:PublicCloudJob|null};this.update({job:body.job});}
  catch{this.update({error:"Statusverbindung unterbrochen. Der Auftrag wird weiter verfolgt; es wird kein neuer Render gestartet."});}
  finally{this.refreshing=false;}
 }
 async start(config:Record<string,unknown>){
  if(this.snapshot.pending||cloudActive(this.snapshot.job))return;
  this.update({pending:"start",error:null});this.key??=crypto.randomUUID();
  try{const response=await this.fetcher("/api/cloud-render",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({requestKey:this.key,config})});
   if(!response.ok){const body=await response.json() as {error?:string};this.update({error:body.error??"Cloud-Start fehlgeschlagen."});await this.refresh();return;}
   this.update({job:await response.json() as PublicCloudJob});this.key=null;
  }catch{this.update({error:"Startantwort fehlt. Status prüfen; derselbe Auftrag wird nicht erneut gerendert."});await this.refresh();}
  finally{this.update({pending:null});}
 }
 async cancel(){const job=this.snapshot.job;if(!job||this.snapshot.pending||!cloudActive(job))return;this.update({pending:"cancel",error:null});
  try{const response=await this.fetcher(`/api/cloud-render/${encodeURIComponent(job.id)}/cancel`,{method:"POST"});if(!response.ok)throw new Error();this.update({job:await response.json() as PublicCloudJob});}
  catch{this.update({error:"Abbruch noch nicht bestätigt. Status weiter prüfen."});}finally{this.update({pending:null});}
 }
 async downloadPath():Promise<string|null>{const job=this.snapshot.job;if(!job?.downloadReady||this.snapshot.pending)return null;this.update({pending:"download",error:null});
  const url=`/api/cloud-render/${encodeURIComponent(job.id)}/download`;
  try{const response=await this.fetcher(url,{method:"HEAD",cache:"no-store"});if(!response.ok)throw new Error();return url;}
  catch{this.update({error:"Download nicht möglich. Anmeldung und Projekt prüfen."});return null;}
  finally{this.update({pending:null});}
 }
}

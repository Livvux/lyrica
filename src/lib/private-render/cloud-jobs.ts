import {createHash,randomUUID} from "node:crypto";
import type {Actor,PrivateStore} from "./store";
import {MAX_RETAINED_BYTES} from "./media";
export type CloudState="queued"|"preparing"|"starting"|"rendering"|"cancelling"|"succeeded"|"failed"|"cancelled"|"needs-attention";
export type CloudJob=Actor&{id:string;state:CloudState;config:Record<string,unknown>;renderId:string|null;progress:number;errorCode:string|null;outputBytes:number;cleanupPending:boolean;cancelRequested:boolean;cancelSent:boolean;attemptConsumed:boolean;leaseUntil:number;invokedAt:number};
export type CloudPoll={state:"running"|"succeeded"|"failed"|"cancelled";progress:number;outputBytes?:number};
export interface CloudAdapter {
 prepare(job:CloudJob):Promise<{inputProps:Record<string,unknown>}>;
 start(job:CloudJob,prepared:{inputProps:Record<string,unknown>}):Promise<string>;
 poll(job:CloudJob):Promise<CloudPoll>;
 cancel(job:CloudJob):Promise<void>;
 cleanup(job:CloudJob):Promise<void>;
 download(job:CloudJob):Promise<string>;
}
const MAX_OUTPUT=50*1024*1024;
const terminal=(state:CloudState)=>["succeeded","failed","cancelled"].includes(state);
const canonical=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==="object"&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const publicJob=(job:CloudJob)=>({id:job.id,state:job.state,progress:job.progress,errorCode:job.errorCode,outputBytes:job.outputBytes,cleanupPending:job.cleanupPending,cancellationConfirmed:job.state==="cancelled",downloadReady:job.state==="succeeded"});
export class CloudJobs {
 constructor(private store:PrivateStore,private adapter:CloudAdapter){}
 private job(id:string):CloudJob|null {
  const row=this.store.db.prepare("SELECT * FROM cloud_jobs WHERE id=?").get(id);if(!row)return null;
  return {id:String(row.id),ownerId:String(row.owner_id),projectId:String(row.project_id),state:row.state as CloudState,config:JSON.parse(String(row.config_json)),renderId:row.render_id?String(row.render_id):null,progress:Number(row.progress),errorCode:row.error_code?String(row.error_code):null,outputBytes:Number(row.output_bytes),cleanupPending:row.cleanup_pending===1,cancelRequested:row.cancel_requested===1,cancelSent:row.cancel_sent===1,attemptConsumed:row.attempt_consumed===1,leaseUntil:Number(row.lease_until),invokedAt:Number(row.invoked_at)};
 }
 private owned(actor:Actor,id:string):CloudJob {const job=this.job(id);if(!job||job.ownerId!==actor.ownerId||job.projectId!==actor.projectId)throw new Error("Nicht gefunden.");return job;}
 private update(id:string,changes:Record<string,string|number|null>){const entries=Object.entries(changes);this.store.db.prepare(`UPDATE cloud_jobs SET ${entries.map(([name])=>`${name}=?`).join(",")},updated_at=? WHERE id=?`).run(...entries.map(([,value])=>value),Date.now(),id);}
 enqueue(actor:Actor,key:string,config:Record<string,unknown>) {
  if(!/^[a-zA-Z0-9_-]{1,128}$/.test(key)||!this.store.project(actor.ownerId,actor.projectId))throw new Error("Ungültiger Export.");
  const json=canonical(config);if(Buffer.byteLength(json)>2*1024*1024)throw new Error("Ungültiger Export.");
  const hash=createHash("sha256").update(json).digest("hex");
  return this.store.transaction(()=>{
   const existing=this.store.db.prepare("SELECT id,config_hash FROM cloud_jobs WHERE owner_id=? AND project_id=? AND request_key=?").get(actor.ownerId,actor.projectId,key);
   if(existing){if(existing.config_hash!==hash)throw new Error("Konflikt: Anfrage wurde bereits anders verwendet.");return publicJob(this.job(String(existing.id))!);}
   if(this.store.db.prepare("SELECT id FROM cloud_jobs WHERE slot_reserved=1").get())throw new Error("Ein Cloud-Export läuft bereits.");
   if(Number(this.store.db.prepare("SELECT COUNT(*) AS count FROM cloud_jobs WHERE attempt_consumed=1").get()!.count)>=1)throw new Error("Das genehmigte Cloud-Testbudget ist verbraucht.");
   if(this.store.retainedMediaBytes()+MAX_OUTPUT>MAX_RETAINED_BYTES)throw new Error("Privater Speicher voll.");
   const id=randomUUID(),now=Date.now();this.store.db.prepare("INSERT INTO cloud_jobs(id,owner_id,project_id,request_key,config_hash,config_json,state,reserved_bytes,created_at,updated_at) VALUES(?,?,?,?,?,?,'queued',?,?,?)").run(id,actor.ownerId,actor.projectId,key,hash,json,MAX_OUTPUT,now,now);
   return publicJob(this.job(id)!);
  });
 }
 status(actor:Actor,id:string){return publicJob(this.owned(actor,id));}
 current(actor:Actor){const row=this.store.db.prepare("SELECT id FROM cloud_jobs WHERE owner_id=? AND project_id=? ORDER BY created_at DESC LIMIT 1").get(actor.ownerId,actor.projectId);return row?this.status(actor,String(row.id)):null;}
 activeIds():string[]{return this.store.db.prepare("SELECT id FROM cloud_jobs WHERE slot_reserved=1 OR cleanup_pending=1").all().map(row=>String(row.id));}
 requestCancel(actor:Actor,id:string){const job=this.owned(actor,id);if(!terminal(job.state)&&job.state!=="needs-attention")this.update(id,{cancel_requested:1,state:"cancelling"});return this.status(actor,id);}
 async download(actor:Actor,id:string):Promise<string>{const job=this.owned(actor,id);if(job.state!=="succeeded"||job.outputBytes<=0)throw new Error("Download noch nicht bereit.");return this.adapter.download(job);}
 private async cleanup(job:CloudJob){try{await this.adapter.cleanup(job);this.update(job.id,{cleanup_pending:0,...(job.state!=="succeeded"?{reserved_bytes:0}:{})});}catch{this.update(job.id,{cleanup_pending:1});}}
 private async finish(job:CloudJob,state:"succeeded"|"failed"|"cancelled",bytes=0){
  this.store.transaction(()=>{
   this.update(job.id,{state,slot_reserved:0,progress:state==="succeeded"?1:job.progress,output_bytes:bytes,cleanup_pending:1,error_code:state==="failed"?"render-failed":null});
   if(state==="succeeded"){
    if(!Number.isSafeInteger(bytes)||bytes<=0||bytes>MAX_OUTPUT)throw new Error("Invalid output");
    this.update(job.id,{reserved_bytes:0});
    this.store.registerMedia(job,{filename:`${job.id}.mp4`,contentType:"video/mp4",size:bytes,objectKey:`exports/${job.ownerId}/${job.projectId}/${job.id}.mp4`});
   }
  });
  await this.cleanup(this.job(job.id)!);
 }
 async advance(id:string):Promise<void>{
  const now=Date.now();const acquired=this.store.db.prepare("UPDATE cloud_jobs SET lease_until=? WHERE id=? AND lease_until<=?").run(now+5*60*1000,id,now);if(acquired.changes!==1)return;
  try {
   let job=this.job(id);if(!job)return;
   if(terminal(job.state)){if(job.cleanupPending)await this.cleanup(job);return;}
   if(job.state==="needs-attention")return;
   if(job.attemptConsumed&&!job.renderId){this.update(id,{state:"needs-attention",error_code:"invocation-uncertain"});return;}
   if(!job.renderId){
    if(job.cancelRequested){await this.finish(job,"cancelled");return;}
    this.update(id,{state:"preparing"});let prepared;
    try{prepared=await this.adapter.prepare(job);}catch{this.update(id,{error_code:"preflight-failed"});await this.finish(job,"failed");this.update(id,{error_code:"preflight-failed"});return;}
    job=this.job(id)!;if(job.cancelRequested){await this.finish(job,"cancelled");return;}
    this.store.transaction(()=>{if(Number(this.store.db.prepare("SELECT COUNT(*) AS count FROM cloud_jobs WHERE attempt_consumed=1").get()!.count)>=1)throw new Error("Testbudget");this.update(id,{state:"starting",attempt_consumed:1,invoked_at:Date.now()});});
    try{const renderId=await this.adapter.start(job,prepared);if(!/^[a-zA-Z0-9_-]{1,80}$/.test(renderId))throw new Error("Invalid render ID");this.update(id,{render_id:renderId,state:this.job(id)!.cancelRequested?"cancelling":"rendering"});}
    catch{this.update(id,{state:"needs-attention",error_code:"invocation-uncertain"});return;}
   }
   job=this.job(id)!;
   if(job.cancelRequested&&!job.cancelSent){try{await this.adapter.cancel(job);this.update(id,{cancel_sent:1,state:"cancelling"});}catch{this.update(id,{error_code:"cancel-pending"});}}
   let result;try{result=await this.adapter.poll(this.job(id)!);}catch{this.update(id,{error_code:"connection-pending"});return;}
   this.update(id,{progress:Math.max(job.progress,Math.min(1,Math.max(0,result.progress))),error_code:null});
   if(result.state!=="running")await this.finish(this.job(id)!,result.state,result.outputBytes??0);
  }finally{this.update(id,{lease_until:0});}
 }
}

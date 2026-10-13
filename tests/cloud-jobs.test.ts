import assert from "node:assert/strict";
import {test} from "node:test";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {PrivateStore} from "../src/lib/private-render/store";
import {CloudJobs,type CloudAdapter,type CloudJob,type CloudPoll} from "../src/lib/private-render/cloud-jobs";
const setup=()=>{const directory=mkdtempSync(path.join(tmpdir(),"lyrica-cloud-test-"));const store=new PrivateStore(directory);return {store,actor:{ownerId:"owner",projectId:store.defaultProject("owner").id},close:()=>{store.close();rmSync(directory,{recursive:true,force:true});}};};
function fixture(overrides:Partial<CloudAdapter>={}){let starts=0,cancels=0,cleanups=0;let progress:CloudPoll={state:"running",progress:0.3};const adapter:CloudAdapter={prepare:async()=>({inputProps:{}}),start:async()=>{starts++;return "render-fixture";},poll:async()=>progress,cancel:async()=>{cancels++;},cleanup:async()=>{cleanups++;},download:async()=>"https://private.example/short-lived",...overrides};return {adapter,setProgress:(value:CloudPoll)=>{progress=value;},counts:()=>({starts,cancels,cleanups})};}
test("cloud start is durable/idempotent, exclusive across projects, owner checked and ceiling enforced",async()=>{
 const f=setup(),a=fixture();try{const service=new CloudJobs(f.store,a.adapter);
  const job=service.enqueue(f.actor,"same-request",{fixture:true});
  assert.equal(service.enqueue(f.actor,"same-request",{fixture:true}).id,job.id);
  assert.throws(()=>service.enqueue(f.actor,"same-request",{fixture:false}),/Konflikt/);
  const other={ownerId:"owner",projectId:f.store.createProject("owner","other").id};
  assert.throws(()=>service.enqueue(other,"another-request",{}),/Export läuft/);
  assert.throws(()=>service.status(other,job.id),/Nicht gefunden/);
  await service.advance(job.id);assert.equal(a.counts().starts,1);
  const restarted=new CloudJobs(f.store,a.adapter);await restarted.advance(job.id);assert.equal(a.counts().starts,1);
  a.setProgress({state:"succeeded",progress:1,outputBytes:1024});await restarted.advance(job.id);
  assert.equal(restarted.status(f.actor,job.id).state,"succeeded");
  assert.ok(await restarted.download(f.actor,job.id));assert.throws(()=>service.enqueue(other,"second-render",{}),/Testbudget/);
 }finally{f.close();}
});
test("ambiguous invocation consumes the attempt and holds reservation across restart",async()=>{
 const f=setup(),a=fixture({start:async()=>{throw new Error("ambiguous SDK error including secret URL");}});try{const service=new CloudJobs(f.store,a.adapter);const job=service.enqueue(f.actor,"ambiguous",{});await service.advance(job.id);
  assert.equal(service.status(f.actor,job.id).state,"needs-attention");
  const restart=new CloudJobs(f.store,a.adapter);await restart.advance(job.id);
  assert.throws(()=>restart.enqueue(f.actor,"retry",{}),/Export läuft|Testbudget/);
  assert.equal(JSON.stringify(restart.status(f.actor,job.id)).includes("secret"),false);
 }finally{f.close();}
});
test("cancellation is explicit and stays pending until remote confirmation",async()=>{
 const f=setup(),a=fixture();try{const service=new CloudJobs(f.store,a.adapter);const job=service.enqueue(f.actor,"cancel",{});await service.advance(job.id);
  service.requestCancel(f.actor,job.id);await service.advance(job.id);
  assert.equal(service.status(f.actor,job.id).state,"cancelling");assert.equal(a.counts().cancels,1);
  a.setProgress({state:"cancelled",progress:0.3});await service.advance(job.id);
  assert.equal(service.status(f.actor,job.id).state,"cancelled");assert.equal(a.counts().starts,1);
 }finally{f.close();}
});
test("failed cleanup retries only that job and successful output stays downloadable",async()=>{
 const f=setup();let fail=true;const ids:string[]=[];const a=fixture({cleanup:async(job:CloudJob)=>{ids.push(job.id);if(fail)throw new Error("timeout");}});try{const service=new CloudJobs(f.store,a.adapter);const job=service.enqueue(f.actor,"cleanup",{});await service.advance(job.id);
  a.setProgress({state:"succeeded",progress:1,outputBytes:512});await service.advance(job.id);
  assert.equal(service.status(f.actor,job.id).cleanupPending,true);assert.ok(await service.download(f.actor,job.id));
  fail=false;await service.advance(job.id);assert.equal(service.status(f.actor,job.id).cleanupPending,false);assert.deepEqual(ids,[job.id,job.id]);
 }finally{f.close();}
});
test("preflight failure spends no Lambda attempt, and queued cancellation never starts",async()=>{
 const f=setup(),a=fixture({prepare:async()=>{throw new Error("expired credential");}});try{const service=new CloudJobs(f.store,a.adapter);const job=service.enqueue(f.actor,"preflight",{});await service.advance(job.id);assert.equal(service.status(f.actor,job.id).state,"failed");
  const second=service.enqueue(f.actor,"cancel-before-start",{});service.requestCancel(f.actor,second.id);await service.advance(second.id);assert.equal(service.status(f.actor,second.id).state,"cancelled");assert.equal(a.counts().starts,0);
 }finally{f.close();}
});

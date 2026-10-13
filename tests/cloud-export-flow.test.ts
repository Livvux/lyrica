import assert from "node:assert/strict";
import {test} from "node:test";
import {CloudExportClient,type PublicCloudJob} from "../src/lib/cloud-export-client";
const job:PublicCloudJob={id:"job-fixture",state:"rendering",progress:0.2,errorCode:null,outputBytes:0,cleanupPending:false,cancellationConfirmed:false,downloadReady:false};
test("double clicks make one start, reconnect restores only the server-owned project job",async()=>{
 let count=0;let release!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve;});
 const client=new CloudExportClient(async(url,init)=>{if(init?.method==="POST"){count++;await waiting;return Response.json(job);}return Response.json({job});});
 const first=client.start({fixture:true});const second=client.start({fixture:true});assert.equal(count,1);release();await Promise.all([first,second]);
 const restored=new CloudExportClient(async()=>Response.json({job}));await restored.refresh();assert.equal(restored.getSnapshot().job?.id,job.id);
});
test("cancel remains cancelling until server confirms, and an observer connection error never submits again",async()=>{
 let writes=0;const client=new CloudExportClient(async(url,init)=>{if(init?.method==="POST"){writes++;return Response.json({...job,state:"cancelling"});}return Response.json({job});});
 await client.refresh();await client.cancel();assert.equal(client.getSnapshot().job?.cancellationConfirmed,false);assert.equal(writes,1);
 const disconnected=new CloudExportClient(async()=>{throw new Error("network");});await disconnected.refresh();assert.ok(disconnected.getSnapshot().error);assert.equal(disconnected.getSnapshot().job,null);
});
test("failed authorized download is shown instead of saving an error as MP4",async()=>{
 const completed={...job,state:"succeeded" as const,downloadReady:true,outputBytes:10};
 const client=new CloudExportClient(async(_url,init)=>init?.method==="HEAD"?Response.json({error:"Sitzung abgelaufen"},{status:401}):Response.json({job:completed}));
 await client.refresh();assert.equal(await client.downloadPath(),null);assert.match(client.getSnapshot().error!,/Download/);
});

import assert from "node:assert/strict";
import {test} from "node:test";
import {cleanupMultipartOutput} from "../src/lib/private-render/multipart-cleanup";
test("failed output cleanup aborts only the exact owned key, across pagination, before deleting it",async()=>{
 const events:string[]=[];const adapter={list:async(_prefix:string,cursor?:string)=>({uploads:cursor?[{key:"exports/owner/project/job.mp4",id:"own-2"}]:[{key:"exports/owner/project/job.mp4",id:"own-1"},{key:"exports/other/project/job.mp4",id:"foreign"}],next:cursor?undefined:"page2"}),abort:async(_key:string,id:string)=>{events.push(id);},delete:async(key:string)=>{events.push(key);}};
 await cleanupMultipartOutput("exports/owner/project/job.mp4",adapter);assert.deepEqual(events,["own-1","own-2","exports/owner/project/job.mp4"]);
});
test("an unconfirmed multipart abort keeps cleanup pending and cannot release retained quota",async()=>{
 let deleted=false;await assert.rejects(cleanupMultipartOutput("exports/owner/project/job.mp4",{list:async()=>({uploads:[{key:"exports/owner/project/job.mp4",id:"own"}]}),abort:async()=>{throw new Error("timeout");},delete:async()=>{deleted=true;}}));assert.equal(deleted,false);
});

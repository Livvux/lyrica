import assert from "node:assert/strict";
import {test} from "node:test";
import {readBoundedBody} from "../src/lib/private-render/body";
test("private request bodies are bounded before JSON or multipart allocation",async()=>{
 assert.equal((await readBoundedBody(new Request("http://localhost",{method:"POST",body:"fixture"}),10)).toString(),"fixture");
 await assert.rejects(readBoundedBody(new Request("http://localhost",{method:"POST",body:"oversized-fixture"}),4),/groß/);
 let cancelled=false;
 const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(8));controller.enqueue(new Uint8Array(8));},cancel(){cancelled=true;}});
 await assert.rejects(readBoundedBody(new Request("http://localhost",{method:"POST",body:stream,duplex:"half"} as RequestInit),10));
 assert.equal(cancelled,true);
});

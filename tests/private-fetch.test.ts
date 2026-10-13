import assert from "node:assert/strict";
import {test} from "node:test";
import {boundRequest,boundMediaUrl} from "../src/lib/private-fetch";
test("tab A keeps explicit project binding even when another tab changes the cookie",()=>{
 const project="d468d71f-1aa6-4f11-b905-0d015f3f6497";
 const request=boundRequest("/api/upload-audio",{method:"POST",headers:{Cookie:"lyrica-project=other"}},project);
 assert.equal(new Headers(request.headers).get("x-lyrica-project"),project);
 assert.equal(boundMediaUrl("/api/audio/private.wav",project),`/api/audio/private.wav?projectId=${project}`);
 assert.equal(boundMediaUrl("/api/cloud-render/job/download",project),`/api/cloud-render/job/download?projectId=${project}`);
 assert.equal(new Headers(boundRequest("https://elsewhere.example/api/video",{},project).headers).has("x-lyrica-project"),false);
});

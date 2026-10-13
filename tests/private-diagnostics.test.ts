import assert from "node:assert/strict";
import {test} from "node:test";
import {privateDiagnostic} from "../src/lib/private-render/diagnostics";
test("render diagnostics omit messages, credentials, signed URLs and payloads",()=>{
 const error=new Error("private lyrics and credential value");error.stack="Error: private payload\n    at renderer (https://example.com/private?signature=secret:1:2)\n    at validate (/app/renderer.js:3:4)\npassword=never-log";
 const result=JSON.stringify(privateDiagnostic(error));assert.equal(result.includes("payload"),false);assert.equal(result.includes("secret"),false);assert.equal(result.includes("password"),false);assert.equal(result.includes("renderer.js"),false);
});
test("render diagnostics discard multiline messages that resemble stack frames and unknown names",()=>{
 const error=new Error("Renderer rejected input:\n    at SYNTHETIC_PRIVATE_LYRIC_PAYLOAD");error.name="SyntheticPrivateCredential";
 assert.deepEqual(privateDiagnostic(error),{name:"Error",hints:[]});
});
test("render diagnostics retain only known classes and fixed failure hints",()=>{
 assert.deepEqual(privateDiagnostic(new TypeError("Image download fetch failed with 403")),{name:"TypeError",hints:["403","fetch","download","image"]});
});

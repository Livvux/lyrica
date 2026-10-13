import assert from "node:assert/strict";
import {test} from "node:test";
import {privateDiagnostic} from "../src/lib/private-render/diagnostics";
test("render diagnostics omit messages, credentials, signed URLs and payloads",()=>{
 const error=new Error("private lyrics and credential value");error.stack="Error: private payload\n    at renderer (https://example.com/private?signature=secret:1:2)\n    at validate (/app/renderer.js:3:4)\npassword=never-log";
 const result=JSON.stringify(privateDiagnostic(error));assert.equal(result.includes("payload"),false);assert.equal(result.includes("secret"),false);assert.equal(result.includes("password"),false);assert.match(result,/renderer.js/);
});

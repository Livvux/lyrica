import assert from "node:assert/strict";
import {test} from "node:test";
import {mkdtempSync,writeFileSync,symlinkSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {servePrivateBundle} from "../src/lib/private-render/bundle-server";
test("local bundle binds loopback and needs its secret route, with ranges and no symlinks",async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),"lyrica-bundle-test-"));
 writeFileSync(path.join(dir,"index.html"),"fixture");writeFileSync(path.join(dir,"asset.wav"),"abcdef");
 writeFileSync(path.join(dir,"logo.svg"),'<svg xmlns="http://www.w3.org/2000/svg"/>');
 symlinkSync("/etc/hosts",path.join(dir,"linked.txt"));
 const server=await servePrivateBundle(dir);
 try {
  assert.equal(new URL(server.url).hostname,"127.0.0.1");
  assert.equal((await fetch(new URL("/asset.wav",server.url))).status,404);
  const asset=new URL("asset.wav",server.url);
  const response=await fetch(asset,{headers:{Range:"bytes=1-3"}});
  assert.equal(response.status,206);assert.equal(await response.text(),"bcd");
  assert.equal((await fetch(new URL("logo.svg",server.url))).headers.get("content-type"),"image/svg+xml");
  assert.equal((await fetch(new URL("linked.txt",server.url))).status,404);
  assert.equal((await fetch(new URL("%2e%2e/%2e%2e/etc/hosts",server.url))).status,404);
 }finally{await server.close();rmSync(dir,{recursive:true,force:true});}
});

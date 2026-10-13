import assert from "node:assert/strict";
import {chmodSync,mkdtempSync,rmSync,writeFileSync} from "node:fs";
import path from "node:path";
import {tmpdir} from "node:os";
import {after,test} from "node:test";
import {readPrivateSettings} from "../src/lib/private-render/settings";
const directory=mkdtempSync(path.join(tmpdir(),"lyrica-settings-"));
const file=path.join(directory,"render.json");
after(()=>rmSync(directory,{recursive:true,force:true}));
test("missing private settings fail closed and disable billable cloud rendering",()=>{
 const settings=readPrivateSettings(file,directory);
 assert.equal(settings.passwordHash,null); assert.equal(settings.cloudEnabled,false);
 assert.equal(settings.maxCloudStarts,1);
});
test("world-readable secret configuration is rejected without returning its contents",()=>{
 writeFileSync(file,JSON.stringify({passwordHash:"fixture-secret"}),{mode:0o644}); chmodSync(file,0o644);
 assert.throws(()=>readPrivateSettings(file,directory),/private configuration permissions/i);
});
test("private settings reject public or arbitrary storage endpoints and unsafe origins",()=>{
 const save=(extra:Record<string,unknown>)=>{writeFileSync(file,JSON.stringify({...extra}),{mode:0o600});chmodSync(file,0o600);};
 for(const endpoint of ["https://evil.example","http://localhost:3000","https://bucket.r2.dev"]){save({r2:{endpoint}});assert.throws(()=>readPrivateSettings(file,directory));}
 save({origins:["https://app.example/path"]});assert.throws(()=>readPrivateSettings(file,directory));
});

import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync,symlinkSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {after,test} from "node:test";
import {PrivateStore} from "../src/lib/private-render/store";
import {PrivateMedia,type MediaStorage} from "../src/lib/private-render/media";
const directory=mkdtempSync(path.join(tmpdir(),"lyrica-owned-media-"));const cache=path.join(directory,"cache");mkdirSync(cache);
const store=new PrivateStore(path.join(directory,"private"));const actor={ownerId:"owner",projectId:store.defaultProject("owner").id};
const remote=new Map<string,Buffer>();
const storage:MediaStorage={put:async(key,bytes)=>{remote.set(key,bytes);},read:async(key)=>{const bytes=remote.get(key);if(!bytes)throw new Error("missing");return bytes;},delete:async(key)=>{remote.delete(key);}};
const media=new PrivateMedia(store,cache,storage);
after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
test("owned uploads archive into project-scoped R2 and recover expired local cache",async()=>{
 const filename="owned.wav";writeFileSync(path.join(cache,filename),"private-fixture");
 const record=await media.register(actor,filename,"audio/wav");
 assert.match(record.objectKey!,new RegExp(`^media/owner/${actor.projectId}/`));
 rmSync(path.join(cache,filename));
 assert.equal(readFileSync(await media.resolve(actor,filename),"utf8"),"private-fixture");
 await assert.rejects(media.resolve({ownerId:"other",projectId:actor.projectId},filename),/Nicht gefunden/);
 await assert.rejects(media.resolve(actor,"guessed.wav"),/Nicht gefunden/);
});
test("media registration rejects symlinks, traversal and oversized real files",async()=>{
 writeFileSync(path.join(directory,"secret.wav"),"secret");symlinkSync(path.join(directory,"secret.wav"),path.join(cache,"linked.wav"));
 await assert.rejects(media.register(actor,"linked.wav","audio/wav"));
 await assert.rejects(media.register(actor,"../secret.wav","audio/wav"));
 writeFileSync(path.join(cache,"too-big.wav"),"oversized");
 await assert.rejects(media.register(actor,"too-big.wav","audio/wav",4));
});
test("failed archive compensates its own object and never leaves a downloadable record",async()=>{
 const failed=new PrivateMedia(store,cache,{...storage,put:async(key,bytes)=>{remote.set(key,bytes);throw new Error("simulated timeout");}});
 writeFileSync(path.join(cache,"failed.wav"),"fixture");
 await assert.rejects(failed.register(actor,"failed.wav","audio/wav"));
 assert.equal(store.media(actor,"failed.wav"),null);
 assert.equal([...remote.keys()].some(key=>key.endsWith("failed.wav")),false);
});
test("ambiguous remote cleanup keeps its quota reserved and blocks media access",async()=>{
 const failed=new PrivateMedia(store,cache,{...storage,put:async()=>{throw new Error("timeout");},delete:async()=>{throw new Error("cleanup timeout");}});
 const before=store.retainedMediaBytes();writeFileSync(path.join(cache,"ambiguous.wav"),"fixture");
 await assert.rejects(failed.register(actor,"ambiguous.wav","audio/wav"));
 assert.equal(store.media(actor,"ambiguous.wav"),null);
 assert.equal(store.retainedMediaBytes(),before+7);
 await assert.rejects(failed.resolve(actor,"ambiguous.wav"));
});
test("quota-rejected uploads remove their unregistered local bytes",async()=>{
 const before=store.retainedMediaBytes();store.registerMedia(actor,{filename:"quota-held.bin",contentType:"application/octet-stream",size:512*1024*1024-before,objectKey:null});
 writeFileSync(path.join(cache,"rejected.wav"),"fixture");
 try{await assert.rejects(media.register(actor,"rejected.wav","audio/wav"),/Speicher voll/);assert.equal(store.media(actor,"rejected.wav"),null);assert.equal(existsSync(path.join(cache,"rejected.wav")),false);}
 finally{store.removeMedia(actor,"quota-held.bin");}
});

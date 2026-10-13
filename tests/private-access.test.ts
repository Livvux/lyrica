import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { PrivateStore } from "../src/lib/private-render/store";
import { hashPassword, verifyPassword, authenticate, assertMutationOrigin } from "../src/lib/private-render/auth";

const directory = mkdtempSync(path.join(tmpdir(), "lyrica-private-"));
const store = new PrivateStore(directory);
after(() => { store.close(); rmSync(directory, {recursive:true,force:true}); });

test("private sessions expire and plaintext bearer tokens never enter SQLite", () => {
  const token = store.createSession("alice", 1000, 10_000);
  assert.equal(store.sessionOwner(token, 10_500), "alice");
  assert.equal(store.sessionOwner(token, 11_001), null);
  store.checkpoint();
  assert.equal(readFileSync(path.join(directory,"private.sqlite")).includes(token), false);
});

test("default projects survive a reopened store and remain owner-bound", () => {
  const first = store.defaultProject("alice");
  const other = new PrivateStore(directory);
  try {
    assert.equal(other.defaultProject("alice").id, first.id);
    assert.notEqual(other.defaultProject("bob").id, first.id);
    assert.equal(other.project("bob", first.id), null);
  } finally { other.close(); }
});

test("registered media require both owner and project, never a guessed filename", () => {
  const alice = {ownerId:"alice",projectId:store.defaultProject("alice").id};
  const bob = {ownerId:"bob",projectId:store.defaultProject("bob").id};
  const record = store.registerMedia(alice, {filename:"12345678-1234-1234-1234-123456789abc.wav",contentType:"audio/wav",size:100,objectKey:null});
  assert.equal(store.media(alice,record.filename)?.id,record.id);
  assert.equal(store.media(bob,record.filename),null);
  assert.equal(store.media({...alice,projectId:store.createProject("alice","Other").id},record.filename),null);
  assert.equal(store.media(alice,"unregistered.mp3"),null);
  assert.throws(()=>store.registerMedia(alice,{filename:"../secret.wav",contentType:"audio/wav",size:100,objectKey:null}));
});

test("password hashes verify exact passwords without storing plaintext", () => {
  const hash = hashPassword("synthetic-test-passphrase");
  assert.equal(hash.includes("synthetic-test-passphrase"), false);
  assert.equal(verifyPassword("synthetic-test-passphrase",hash),true);
  assert.equal(verifyPassword("wrong",hash),false);
  assert.equal(verifyPassword("anything","malformed"),false);
});

test("web and verified desktop sessions identify the owner; spoofed headers do not", () => {
  const token = store.createSession("alice",60_000);
  const options = {ownerId:"alice",desktopToken:"synthetic-desktop-token",desktopOrigin:"http://127.0.0.1:47831"};
  assert.equal(authenticate(new Request("http://localhost",{headers:{cookie:`lyrica-private=${token}`}}),store,options),"alice");
  assert.equal(authenticate(new Request("http://127.0.0.1:47831",{headers:{cookie:"lyrica-desktop=synthetic-desktop-token"}}),store,options),"alice");
  assert.equal(authenticate(new Request("https://external.example",{headers:{cookie:"lyrica-desktop=synthetic-desktop-token"}}),store,options),null);
  assert.equal(authenticate(new Request("http://localhost",{headers:{"x-user":"alice"}}),store,options),null);
  store.revokeSession(token);
  assert.equal(store.sessionOwner(token),null);
});

test("mutations reject cross-origin and missing Origin without weakening desktop auth", () => {
  const allowed=["http://localhost:3214"];
  assert.doesNotThrow(()=>assertMutationOrigin(new Request(allowed[0],{method:"POST",headers:{origin:allowed[0]}}),allowed));
  const invalid: HeadersInit[] = [{origin:"https://evil.example"},{},{origin:allowed[0],"sec-fetch-site":"cross-site"}];
  for(const headers of invalid) {
    assert.throws(()=>assertMutationOrigin(new Request(allowed[0],{method:"POST",headers}),allowed));
  }
});

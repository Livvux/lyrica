import assert from "node:assert/strict";
import {test} from "node:test";
import {validMediaHeader} from "../src/lib/private-render/media-header";
test("media upload checks actual headers and rejects SVG or playlists disguised as images/audio",()=>{
 assert.equal(validMediaHeader(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),"image/jpeg"),false);
 assert.equal(validMediaHeader(Buffer.from('#EXTM3U\nhttp://private.internal/audio'),"audio/mpeg"),false);
 assert.equal(validMediaHeader(Buffer.from([0xff,0xd8,0xff,0xe0]),"image/jpeg"),true);
 assert.equal(validMediaHeader(Buffer.from("RIFF0000WAVEfmt "),"audio/wav"),true);
 assert.equal(validMediaHeader(Buffer.from("RIFF0000WEBPVP8 "),"image/webp"),true);
});

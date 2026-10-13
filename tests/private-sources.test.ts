import assert from "node:assert/strict";
import {test} from "node:test";
import {assetReferences} from "../src/lib/private-render/sources";
import {DEFAULT_STYLE,type VideoConfig} from "../src/types/lyrics";
const config:VideoConfig={audioUrl:"/api/audio/owned.wav",style:DEFAULT_STYLE,lines:[],durationInFrames:120,fps:24,width:1280,height:720};
test("both export backends only accept owned project media or the reviewed default background",()=>{
 assert.deepEqual(assetReferences(config),[{role:"audio",filename:"owned.wav"}]);
 for(const audioUrl of ["http://localhost:3002/api/audio/owned.wav","https://example.com/a.wav","blob:secret","/api/audio/../secret.wav","/api/audio/owned.wav?token=x"])
  assert.throws(()=>assetReferences({...config,audioUrl}));
 assert.throws(()=>assetReferences({...config,style:{...DEFAULT_STYLE,bgImage:"https://example.com/bg.jpg"}}));
 assert.throws(()=>assetReferences({...config,style:{...DEFAULT_STYLE,customLogo:"/logo.svg"}}));
});

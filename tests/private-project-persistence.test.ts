import assert from "node:assert/strict";
import {test} from "node:test";
import {savePersistence,loadPersistence} from "../src/lib/use-persistence";
import {DEFAULT_STYLE} from "../src/types/lyrics";
test("pending autosave from A never overwrites B after a delayed project switch",()=>{
 const values=new Map<string,string>();
 Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)}});
 Object.defineProperty(globalThis,"sessionStorage",{configurable:true,value:{getItem:()=>"owner:B"}});
 const state={lines:[],audioUrl:null,durationSec:5,style:DEFAULT_STYLE,lyricsActive:false};
 try{savePersistence({...state,durationSec:10},"owner:B");savePersistence(state,"owner:A");assert.equal(loadPersistence("owner:B")!.durationSec,10);assert.equal(loadPersistence("owner:A")!.durationSec,5);}
 finally{Reflect.deleteProperty(globalThis,"localStorage");Reflect.deleteProperty(globalThis,"sessionStorage");}
});

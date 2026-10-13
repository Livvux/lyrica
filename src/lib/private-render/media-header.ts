export function validMediaHeader(bytes:Buffer,type:string):boolean {
 const starts=(text:string)=>bytes.subarray(0,text.length).equals(Buffer.from(text));
 const riff=(kind:string)=>starts("RIFF")&&bytes.subarray(8,12).toString("ascii")===kind;
 const mp4=bytes.subarray(4,8).toString("ascii")==="ftyp";
 const webm=bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]));
 switch(type.toLowerCase()){
  case "image/jpeg":return bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
  case "image/png":return bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  case "image/webp":return riff("WEBP");
  case "image/gif":return starts("GIF87a")||starts("GIF89a");
  case "image/avif":return mp4&&["avif","avis"].includes(bytes.subarray(8,12).toString("ascii"));
  case "audio/wav":case "audio/x-wav":return riff("WAVE");
  case "audio/mpeg":case "audio/mp3":return starts("ID3")||(bytes[0]===0xff&&(bytes[1]&0xe0)===0xe0);
  case "audio/aac":return bytes[0]===0xff&&(bytes[1]&0xf6)===0xf0;
  case "audio/flac":case "audio/x-flac":return starts("fLaC");
  case "audio/ogg":case "application/ogg":return starts("OggS");
  case "audio/mp4":case "audio/x-m4a":case "video/mp4":return mp4;
  case "audio/webm":case "video/webm":return webm;
  default:return false;
 }
}

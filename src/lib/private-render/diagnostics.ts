/** No exception message/payload: callsites identify the failing boundary safely. */
export function privateDiagnostic(error:unknown):{name:string;frames:string[];hints:string[]} {
 const frames=error instanceof Error?error.stack?.split("\n").filter(line=>/^\s+at /.test(line)).slice(0,6).map(line=>line.replace(/https?:\/\/\S+/g,"[private-url]").replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,"[key]").replace(/\b[a-f0-9]{64}\b/g,"[private-value]"))??[]:[];
 const message=error instanceof Error?error.message.toLowerCase():"";const hints=["404","403","fetch","download","image","audio","video","decode","timeout","cancel","network","cors","range"].filter(word=>message.includes(word));
 return {hints,name:error instanceof Error&&/^[A-Za-z]{1,40}$/.test(error.name)?error.name:"Error",frames};
}

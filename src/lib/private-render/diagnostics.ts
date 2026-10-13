/** Never emit exception messages, stacks or arbitrary error names. */
export function privateDiagnostic(error:unknown):{name:string;hints:string[]} {
 const allowedNames=["Error","TypeError","RangeError","SyntaxError","CancelledError","TimeoutError","AbortError","ReferenceError","URIError","EvalError"];
 const message=error instanceof Error?error.message.toLowerCase():"";const hints=["404","403","fetch","download","image","audio","video","decode","timeout","cancel","network","cors","range"].filter(word=>message.includes(word));
 return {name:error instanceof Error&&allowedNames.includes(error.name)?error.name:"Error",hints};
}

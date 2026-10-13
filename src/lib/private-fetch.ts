/** Keep API/media scope in this tab, independent of the shared cookie jar. */
export function currentProject():string|null {
 if(typeof sessionStorage==="undefined")return null;
 const bound=sessionStorage.getItem("lyrica-private-project")?.split(":").at(-1);
 return bound&&/^[a-f0-9-]{36}$/.test(bound)?bound:null;
}
export function bindProject(ownerId:string,projectId:string){sessionStorage.setItem("lyrica-private-project",`${ownerId}:${projectId}`);}
export function boundRequest(url:string,init:RequestInit={},projectId:string|null=currentProject()):RequestInit {
 const headers=new Headers(init.headers);if(url.startsWith("/api/")&&projectId)headers.set("x-lyrica-project",projectId);
 return {...init,headers};
}
export function boundMediaUrl(url:string,projectId:string|null=currentProject()):string {
 if(!url.startsWith("/api/")||!projectId)return url;return `${url}${url.includes("?")?"&":"?"}projectId=${encodeURIComponent(projectId)}`;
}
export function privateFetch(url:string,init?:RequestInit):Promise<Response>{return fetch(url,boundRequest(url,init));}

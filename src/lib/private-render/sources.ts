import type {VideoConfig} from "../../types/lyrics";
export type AssetReference={role:"audio"|"background"|"logo";filename:string};
export function assetFilename(url:string):string {
 const match=/^\/api\/audio\/([a-zA-Z0-9_-]+\.[a-zA-Z0-9]+)(?:\?projectId=[a-f0-9-]{36})?$/.exec(url);
 if(!match)throw new Error("Nur private Projektmedien sind erlaubt.");return match[1];
}
export function assetReferences(config:VideoConfig):AssetReference[] {
 const refs:AssetReference[]=[{role:"audio",filename:assetFilename(config.audioUrl)}];
 if(config.style.bgImage!=="/bg-default.jpg")refs.push({role:"background",filename:assetFilename(config.style.bgImage)});
 if(config.style.customLogo)refs.push({role:"logo",filename:assetFilename(config.style.customLogo)});
 return refs;
}

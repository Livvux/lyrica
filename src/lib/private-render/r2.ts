import {S3Client,PutObjectCommand,GetObjectCommand,DeleteObjectCommand} from "@aws-sdk/client-s3";
import {getSignedUrl} from "@aws-sdk/s3-request-presigner";
import {getSettings,type R2Settings} from "./settings";
import type {MediaStorage} from "./media";
export function r2Client(settings:R2Settings,output=false):S3Client {return new S3Client({region:"auto",endpoint:settings.endpoint,forcePathStyle:true,maxAttempts:1,credentials:{accessKeyId:output?settings.outputAccessKeyId:settings.mediaAccessKeyId,secretAccessKey:output?settings.outputSecretAccessKey:settings.mediaSecretAccessKey}});}
export function mediaStorage(output=false):MediaStorage|undefined {
 const settings=getSettings().r2;if(!settings)return undefined;const client=r2Client(settings,output);const Bucket=output?settings.outputBucket:settings.mediaBucket;
 return {put:async(Key,Body,ContentType)=>{await client.send(new PutObjectCommand({Bucket,Key,Body,ContentType}));},
  read:async(Key,maximumBytes)=>{const result=await client.send(new GetObjectCommand({Bucket,Key}));if(!result.Body||result.ContentLength!==maximumBytes)throw new Error("Invalid media length");return Buffer.from(await result.Body.transformToByteArray());},
  delete:async(Key)=>{await client.send(new DeleteObjectCommand({Bucket,Key}));}};
}
export async function signOutput(Key:string):Promise<string> {
 const settings=getSettings().r2;if(!settings)throw new Error("R2 not configured");
 return getSignedUrl(r2Client(settings,true),new GetObjectCommand({Bucket:settings.outputBucket,Key,ResponseContentDisposition:'attachment; filename="lyrica-video.mp4"'}),{expiresIn:300});
}

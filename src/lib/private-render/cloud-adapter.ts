import {S3Client,PutObjectCommand,GetObjectCommand,HeadObjectCommand,ListObjectsV2Command,DeleteObjectsCommand,DeleteObjectCommand,ListMultipartUploadsCommand,AbortMultipartUploadCommand} from "@aws-sdk/client-s3";
import {STSClient,GetCallerIdentityCommand} from "@aws-sdk/client-sts";
import {fromIni} from "@aws-sdk/credential-providers";
import {getSignedUrl} from "@aws-sdk/s3-request-presigner";
import {renderMediaOnLambda,getRenderProgress,cancelRenderOnLambda} from "@remotion/lambda/client";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {writeFile,readFile,lstat,mkdir} from "node:fs/promises";
import {existsSync} from "node:fs";
import path from "node:path";
import {getSettings,FUNCTION_NAME,type PrivateSettings} from "./settings";
import {r2Client,signOutput} from "./r2";
import {validateOwnedSources,resolveOwnedMedia} from "./owned-media";
import {assetReferences} from "./sources";
import {cleanupMultipartOutput} from "./multipart-cleanup";
import {VideoConfigSchema} from "./schema";
import type {CloudAdapter,CloudJob} from "./cloud-jobs";
import type {VideoConfig} from "../../types/lyrics";
const execFileAsync=promisify(execFile);
const REGION="eu-central-1";
let limitedProfile:Promise<ReturnType<typeof fromIni>>|null=null;
async function awsCredentials(settings:PrivateSettings){
 if(!limitedProfile)limitedProfile=(async()=>{
  if(settings.awsRoleArn!=="arn:aws:iam::721467105811:role/lyrica-remotion-client-pilot")throw new Error("Unreviewed AWS role");
  const directory=path.join(settings.dataDirectory,"aws-client");await mkdir(directory,{recursive:true,mode:0o700});
  const config=path.join(directory,"config"),empty=path.join(directory,"credentials");
  for(const target of [directory,config,empty]){try{const stat=await lstat(target);if(stat.isSymbolicLink()||(target===directory?!stat.isDirectory():!stat.isFile()))throw new Error("Unsafe client profile path");}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}}
  const source="/usr/bin/env -u AWS_CONFIG_FILE -u AWS_SHARED_CREDENTIALS_FILE -u AWS_PROFILE -u REMOTION_AWS_PROFILE -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN /opt/homebrew/bin/aws configure export-credentials --profile lyrica-pilot-operator --format process";
  await writeFile(config,`[profile lyrica-cloud-source]\nregion = ${REGION}\ncredential_process = ${source}\n\n[profile lyrica-cloud-client]\nregion = ${REGION}\nrole_arn = ${settings.awsRoleArn}\nsource_profile = lyrica-cloud-source\nduration_seconds = 900\nrole_session_name = lyrica-private-export\n`,{mode:0o600});
  await writeFile(empty,"",{mode:0o600});
  // Remotion uses an explicit profile before all static credential sources.
  process.env.AWS_CONFIG_FILE=config;process.env.AWS_SHARED_CREDENTIALS_FILE=empty;process.env.REMOTION_AWS_PROFILE="lyrica-cloud-client";
  return fromIni({profile:"lyrica-cloud-client",configFilepath:config,filepath:empty});
 })().catch(error=>{limitedProfile=null;throw error;});
 return limitedProfile;
}
const outputKey=(job:CloudJob)=>`exports/${job.ownerId}/${job.projectId}/${job.id}.mp4`;
function checkedConfig(job:CloudJob):VideoConfig {
 const config=VideoConfigSchema.parse(job.config);
 const seconds=config.durationInFrames/config.fps;
 if(seconds>30||seconds<=0||Buffer.byteLength(JSON.stringify(config))>45*1024)throw new Error("Cloud pilot limits exceeded");
 return {...config,renderQuality:"fast",width:1280,height:720,fps:24,durationInFrames:Math.ceil(seconds*24),lines:config.lines.map(line=>({...line,startFrame:Math.round(line.startSec*24),endFrame:Math.round(line.endSec*24)})),style:{...config.style,fontFamily:"sans-serif"}};
}
export function productionCloudAdapter():CloudAdapter {
 const settings=getSettings();if(!settings.r2||!settings.inputBucket||!settings.renderBucket||!settings.serveUrl)throw new Error("Cloud setup incomplete");
 const r2=settings.r2,inputBucket=settings.inputBucket,renderBucket=settings.renderBucket,serveUrl=settings.serveUrl;
 if(inputBucket!=="lyrica-input-pilot-721467105811-euc1"||renderBucket!=="remotionlambda-lyrica-pilot-721467105811-euc1"||serveUrl!=="https://ds74ucggqvz87.cloudfront.net/sites/lyrica-4-0-535-pilot/index.html")throw new Error("Unreviewed pilot resources");
 const output=r2Client(r2,true);
 const s3=async()=>new S3Client({region:REGION,maxAttempts:1,credentials:await awsCredentials(settings)});
 const credentials={endpoint:r2.endpoint,accessKeyId:r2.outputAccessKeyId,secretAccessKey:r2.outputSecretAccessKey,region:"auto",forcePathStyle:true};
 return {
  prepare:async job=>{
   const config=checkedConfig(job);await validateOwnedSources(job,config);
   const aws=await awsCredentials(settings);
   const identity=await new STSClient({region:REGION,maxAttempts:1,credentials:aws}).send(new GetCallerIdentityCommand({}));
   if(identity.Account!=="721467105811"||!identity.Arn?.startsWith("arn:aws:sts::721467105811:assumed-role/lyrica-remotion-client-pilot/"))throw new Error("Unexpected AWS identity");
   const code=await fetch(serveUrl,{method:"HEAD",signal:AbortSignal.timeout(10000)});if(!code.ok)throw new Error("Renderer code unavailable");
   // Verify bucket permission without exposing credentials or public object access.
   await output.send(new ListObjectsV2Command({Bucket:r2.outputBucket,Prefix:`exports/${job.ownerId}/${job.projectId}/`,MaxKeys:1}));
   const refs=assetReferences(config);let aggregate=0;const sources:Array<{name:string;role:string;source:string}>=[];
   for(const ref of refs)sources.push({name:ref.filename,role:ref.role,source:await resolveOwnedMedia(job,ref.filename)});
   if(config.style.bgImage==="/bg-default.jpg")sources.push({name:"bg-default.jpg",role:"background",source:path.join(process.cwd(),"public","bg-default.jpg")});
   const ffprobe=process.env.FFPROBE_PATH??(existsSync("/opt/homebrew/bin/ffprobe")?"/opt/homebrew/bin/ffprobe":"ffprobe");
   const audio=sources.find(file=>file.role==="audio")!;
   const probe=await execFileAsync(ffprobe,["-v","error","-protocol_whitelist","file,pipe","-show_entries","format=duration:stream=codec_type,width,height","-of","json",audio.source],{timeout:15000,maxBuffer:65536});
   const metadata=JSON.parse(probe.stdout);const duration=Number(metadata.format?.duration);
   if(!Number.isFinite(duration)||duration<=0||duration>30.1||!metadata.streams?.some((stream:{codec_type:string})=>stream.codec_type==="audio"))throw new Error("Audio outside pilot limits");
   const client=await s3();const urls:Record<string,string>={};
   for(const file of sources){const info=await lstat(file.source);if(!info.isFile()||info.isSymbolicLink()||info.size>25*1024*1024)throw new Error("Media outside pilot limits");aggregate+=info.size;if(aggregate>50*1024*1024)throw new Error("Aggregate media outside pilot limits");
    if(file.role!=="audio"){const p=await execFileAsync(ffprobe,["-v","error","-protocol_whitelist","file,pipe","-show_entries","stream=width,height","-of","json",file.source],{timeout:15000,maxBuffer:65536});const streams=JSON.parse(p.stdout).streams;if(!streams?.length||streams.some((s:{width:number;height:number})=>!s.width||!s.height||s.width>4096||s.height>4096))throw new Error("Image/video dimensions outside pilot limits");}
    const Key=`jobs/${job.id}/${file.name}`;await client.send(new PutObjectCommand({Bucket:inputBucket,Key,Body:await readFile(file.source),ContentType:file.role==="audio"?"audio/mpeg":"application/octet-stream",ServerSideEncryption:"AES256"}));
    urls[file.role]=await getSignedUrl(client,new GetObjectCommand({Bucket:inputBucket,Key}),{expiresIn:900});
   }
   const inputProps={...config,audioUrl:urls.audio,style:{...config.style,bgImage:urls.background,customLogo:urls.logo??null}} as unknown as Record<string,unknown>;
   if(Buffer.byteLength(JSON.stringify(inputProps))>50*1024)throw new Error("Props outside pilot limits");
   return {inputProps};
  },
  start:async(job,prepared)=>{
   await awsCredentials(settings);
   const result=await renderMediaOnLambda({region:REGION,functionName:FUNCTION_NAME,serveUrl,composition:"LyricsVideo",codec:"h264",inputProps:prepared.inputProps,forceBucketName:renderBucket,concurrency:1,concurrencyPerLambda:1,maxRetries:0,privacy:"no-acl",enableCancellation:true,envVariables:{},logLevel:"error",isProduction:false,crf:23,outName:{bucketName:r2.outputBucket,key:outputKey(job),s3OutputProvider:credentials}});
   if(result.bucketName!==renderBucket)throw new Error("Unexpected render bucket");return result.renderId;
  },
  poll:async job=>{
   await awsCredentials(settings);if(!job.renderId)throw new Error("Missing render ID");
   const progress=await getRenderProgress({region:REGION,functionName:FUNCTION_NAME,bucketName:renderBucket,renderId:job.renderId,skipLambdaInvocation:true,logLevel:"error",s3OutputProvider:credentials});
   if(progress.done){if(progress.outBucket!==r2.outputBucket||progress.outKey!==outputKey(job))throw new Error("Output binding mismatch");const head=await output.send(new HeadObjectCommand({Bucket:r2.outputBucket,Key:outputKey(job)}));if(!head.ContentLength||head.ContentLength>50*1024*1024)return {state:"failed",progress:1};return {state:"succeeded",progress:1,outputBytes:head.ContentLength};}
   if(progress.fatalErrorEncountered){const cancelled=job.cancelSent&&progress.errors.some(error=>/cancel/i.test(error.message));return {state:cancelled?"cancelled":"failed",progress:progress.overallProgress};}
   return {state:"running",progress:progress.overallProgress};
  },
  cancel:async job=>{await awsCredentials(settings);if(!job.renderId)throw new Error("Missing render ID");await cancelRenderOnLambda({region:REGION,bucketName:renderBucket,renderId:job.renderId});},
  cleanup:async job=>{
   // An error signal can precede the last function exit. Keep quota/objects until
   // the reviewed120s function +60s async age (no retries) cannot write again.
   if(job.state!=="succeeded"&&job.attemptConsumed&&Date.now()<job.invokedAt+360000)throw new Error("Cleanup waits for bounded worker exit");
   const client=await s3();
   const prefixes=[{Bucket:inputBucket,Prefix:`jobs/${job.id}/`},...(job.renderId?[{Bucket:renderBucket,Prefix:`renders/${job.renderId}/`}]:[])];
   for(const scope of prefixes){let cursor:string|undefined;do{const objects=await client.send(new ListObjectsV2Command({...scope,ContinuationToken:cursor}));const keys=objects.Contents?.map(object=>({Key:object.Key!})).filter(object=>object.Key.startsWith(scope.Prefix))??[];if(keys.length){const removed=await client.send(new DeleteObjectsCommand({Bucket:scope.Bucket,Delete:{Objects:keys,Quiet:true}}));if(removed.Errors?.length)throw new Error("Cleanup pending");}cursor=objects.NextContinuationToken;}while(cursor);}
   if(job.state!=="succeeded")await cleanupMultipartOutput(outputKey(job),{
    list:async(Prefix,cursor)=>{const markers=cursor?JSON.parse(cursor) as {KeyMarker:string;UploadIdMarker:string}:{};const result=await output.send(new ListMultipartUploadsCommand({Bucket:r2.outputBucket,Prefix,...markers}));if(result.IsTruncated&&!result.NextKeyMarker)throw new Error("Multipart cleanup pagination uncertain");return {uploads:result.Uploads?.filter(upload=>upload.Key&&upload.UploadId).map(upload=>({key:upload.Key!,id:upload.UploadId!}))??[],next:result.IsTruncated?JSON.stringify({KeyMarker:result.NextKeyMarker,UploadIdMarker:result.NextUploadIdMarker}):undefined};},
    abort:async(Key,UploadId)=>{await output.send(new AbortMultipartUploadCommand({Bucket:r2.outputBucket,Key,UploadId}));},
    delete:async(Key)=>{await output.send(new DeleteObjectCommand({Bucket:r2.outputBucket,Key}));},
   });
  },
  download:async job=>signOutput(outputKey(job)),
 };
}

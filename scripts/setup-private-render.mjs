// Run personally in a terminal. Secret answers never echo, enter argv or logs.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline/promises';
import {Writable} from 'node:stream';
import {randomBytes,scryptSync} from 'node:crypto';
const args=process.argv.slice(2);
const option=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
if(!process.stdin.isTTY){console.error('Bitte diesen Setup-Wizard persönlich in einem Terminal ausführen.');process.exit(1);}
async function secret(label){process.stdout.write(label+': ');const silent=new Writable({write(_chunk,_encoding,done){done();}});const input=readline.createInterface({input:process.stdin,output:silent,terminal:true});try{return(await input.question('')).trim();}finally{input.close();process.stdout.write('\n');}}
const directory=option('--data-dir')??path.join(os.homedir(),'Library','Application Support','Lyrica','private');
const filename=path.join(directory,'render-config.json');
try{
 const absolute=path.resolve(directory);
 for(let current=absolute;;current=path.dirname(current)){
  try{const stat=await fs.lstat(current);if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('Privater Datenpfad darf keine Symlinks enthalten.');}catch(error){if(error.code!=='ENOENT')throw error;}
  if(path.dirname(current)===current)break;
 }
 await fs.mkdir(absolute,{recursive:true,mode:0o700});await fs.chmod(absolute,0o700);
 try{await fs.access(filename);throw new Error('Konfiguration existiert bereits; sie wird nicht automatisch ersetzt.');}catch(e){if(e.code!=='ENOENT')throw e;}
 const password=await secret('Neues privates Lyrica-Passwort (mindestens 12 Zeichen)');
 const confirmation=await secret('Passwort bestätigen');
 if(password.length<12||password.length>256||password!==confirmation)throw new Error('Passwortbestätigung oder Länge ungültig.');
 const salt=randomBytes(32).toString('hex');
 const config={ownerId:'owner',passwordHash:`scrypt:${salt}:${scryptSync(password,salt,64).toString('hex')}`,
  origins:(option('--origins')??'http://127.0.0.1:3002,http://localhost:3002,https://lyrica.ts.lkmedia.xyz').split(','),cloudEnabled:false};
 const pilot=option('--pilot-manifest');
 if(pilot){const approved=JSON.parse(await fs.readFile(pilot,'utf8'));config.awsRoleArn=`arn:aws:iam::${approved.account}:role/lyrica-remotion-client-pilot`;config.inputBucket=approved.resourceNames.inputBucket;config.renderBucket=approved.resourceNames.renderBucket;const outputs=JSON.parse(await fs.readFile(path.join(path.dirname(pilot),'aws-validation/stack-outputs.json'),'utf8'));config.serveUrl=outputs.outputs.ServeUrl;}
 const endpoint=option('--r2-endpoint');
 if(endpoint){
  if(!/^https:\/\/[a-f0-9]{32}(?:\.eu)?\.r2\.cloudflarestorage\.com$/.test(endpoint))throw new Error('Ungültiger privater R2-Endpoint.');
  console.log('Nur die zuvor freigegebenen, bucketbegrenzten Tokens verwenden.');
  config.r2={endpoint,mediaAccessKeyId:await secret('Medien-Bucket Access Key ID'),mediaSecretAccessKey:await secret('Medien-Bucket Secret Access Key'),outputAccessKeyId:await secret('Ergebnis-Bucket Access Key ID'),outputSecretAccessKey:await secret('Ergebnis-Bucket Secret Access Key')};
  if(Object.values(config.r2).some(value=>!value))throw new Error('R2-Konfiguration unvollständig.');
 }
 await fs.writeFile(filename,JSON.stringify(config,null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log('Private Konfiguration gespeichert. Cloud bleibt bis zur Abnahme ausgeschaltet.');
}catch(error){console.error(error instanceof Error?error.message:'Setup fehlgeschlagen.');process.exitCode=1;}

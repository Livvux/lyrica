// Owner-only setup on loopback. Never log requests, passwords or credentials.
import {createServer} from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes,scryptSync} from 'node:crypto';
const port=3338,origin=`http://127.0.0.1:${port}`;
const directory=path.join(os.homedir(),'Library','Application Support','Lyrica','private');
const filename=path.join(directory,'render-config.json');
const pilotRoot=path.resolve(import.meta.dirname,'../..');
const manifest=JSON.parse(await fs.readFile(path.join(pilotRoot,'pilot-approval-manifest.json'),'utf8'));
const outputs=JSON.parse(await fs.readFile(path.join(pilotRoot,'aws-validation/stack-outputs.json'),'utf8'));
const csrf=randomBytes(32).toString('hex');let attempts=0,saved=false;
function page(body){return `<!doctype html><html lang="de"><meta charset="utf-8"><title>Lyrica – privates Setup</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font:17px system-ui;background:#101218;color:#eee;max-width:680px;margin:40px auto;padding:20px}h1{font-size:28px}label{display:block;margin:18px 0 6px}input{box-sizing:border-box;width:100%;padding:12px;background:#222631;color:white;border:1px solid #677;border-radius:6px}button{margin-top:24px;padding:14px 22px;background:#b6c4ff;border:0;border-radius:6px;font-size:17px}small{color:#c5c8d0}fieldset{margin:25px 0;border:1px solid #555;border-radius:8px}</style><body>${body}</body></html>`;}
function respond(res,status,body){res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",'Set-Cookie':`lyrica-setup=${csrf}; HttpOnly; SameSite=Strict; Path=/`});res.end(page(body));}
const field=(name,label)=>`<label for="${name}">${label}</label><input id="${name}" name="${name}" type="password" autocomplete="off" required maxlength="256">`;
const server=createServer(async(req,res)=>{
 try{
  if(req.headers.host!==`127.0.0.1:${port}`){respond(res,403,'<h1>Anfrage nicht erlaubt</h1>');return;}
  if(req.method==='GET'&&req.url==='/'){
   if(saved){respond(res,200,'<h1>Private Konfiguration gespeichert</h1><p>Cloud bleibt bis zur Abnahme ausgeschaltet. Du kannst dieses Fenster schließen.</p>');return;}
   respond(res,200,`<h1>Privates Lyrica-Setup</h1><p>Nur auf diesem Mac mini. Keine Werte in den Chat kopieren. Verwende die freigegebenen, auf jeweils einen Bucket begrenzten S3-Zugangsdaten.</p><form action="/save" method="post"><fieldset><legend>Private Anmeldung</legend>${field('password','Neues Lyrica-Passwort (mindestens 12 Zeichen)')}${field('confirmation','Passwort bestätigen')}</fieldset><fieldset><legend>lyrica-private-media – Object Read & Write nur dieser Bucket</legend>${field('mediaAccessKeyId','Access Key ID')}${field('mediaSecretAccessKey','Secret Access Key')}</fieldset><fieldset><legend>lyrica-private-renders – Object Read & Write nur dieser Bucket</legend>${field('outputAccessKeyId','Access Key ID')}${field('outputSecretAccessKey','Secret Access Key')}</fieldset><small>EU-Endpoint ist festgelegt. Die Konfiguration wird als neue Datei mit Zugriffsrechten 0600 gespeichert. Bestehende .env.local und Dienste bleiben unverändert.</small><button type="submit">Persönlich bestätigen und sicher speichern</button></form>`);return;
  }
  if(req.method!=='POST'||req.url!=='/save'||req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site'||!req.headers.cookie?.split(/;\s*/).includes(`lyrica-setup=${csrf}`)||saved||++attempts>5){respond(res,403,'<h1>Anfrage nicht erlaubt</h1>');return;}
  let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>10000)throw new Error('Invalid input');chunks.push(chunk);}
  const body=new URLSearchParams(Buffer.concat(chunks).toString('utf8'));const password=body.get('password')??'',confirmation=body.get('confirmation')??'';
  if(password.length<12||password.length>256||password!==confirmation)throw new Error('Invalid input');
  const r2={endpoint:'https://40f4d4e010f358d7aea47e7b10d02a47.eu.r2.cloudflarestorage.com'};
  for(const key of ['mediaAccessKeyId','mediaSecretAccessKey','outputAccessKeyId','outputSecretAccessKey']){const value=body.get(key)?.trim()??'';if(!/^[a-f0-9]{24,128}$/.test(value))throw new Error('Invalid input');r2[key]=value;}
  if(r2.mediaAccessKeyId===r2.outputAccessKeyId)throw new Error('Invalid input');
  for(let current=directory;;current=path.dirname(current)){try{const stat=await fs.lstat(current);if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('Unsafe path');}catch(error){if(error.code!=='ENOENT')throw error;}if(path.dirname(current)===current)break;}
  await fs.mkdir(directory,{recursive:true,mode:0o700});await fs.chmod(directory,0o700);
  const salt=randomBytes(32).toString('hex');
  const config={ownerId:'owner',passwordHash:`scrypt:${salt}:${scryptSync(password,salt,64).toString('hex')}`,origins:['http://127.0.0.1:3002','http://localhost:3002','https://lyrica.ts.lkmedia.xyz'],cloudEnabled:false,awsRoleArn:`arn:aws:iam::${manifest.account}:role/lyrica-remotion-client-pilot`,inputBucket:manifest.resourceNames.inputBucket,renderBucket:manifest.resourceNames.renderBucket,serveUrl:outputs.outputs.ServeUrl,r2};
  await fs.writeFile(filename,JSON.stringify(config,null,2)+'\n',{mode:0o600,flag:'wx'});saved=true;
  respond(res,200,'<h1>Private Konfiguration gespeichert</h1><p>Passwort und Zugangsdaten wurden geschützt auf diesem Mac gespeichert. Cloud bleibt bis zur Abnahme ausgeschaltet.</p>');
 }catch{respond(res,400,'<h1>Speichern nicht möglich</h1><p>Bitte Passwortbestätigung und die vier S3-Felder prüfen. Eine bestehende Konfiguration wird nicht überschrieben. Es werden keine Zugangsdaten angezeigt.</p>');}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
console.log('Privater Setup-Wizard bereit: http://127.0.0.1:3338 (15 Minuten).');
setTimeout(()=>{server.close();server.closeAllConnections();},15*60*1000);
process.on('SIGTERM',()=>{server.close();server.closeAllConnections();});

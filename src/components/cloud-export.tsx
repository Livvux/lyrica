"use client";
import {privateFetch as fetch,boundMediaUrl} from "@/lib/private-fetch";
import {useEffect,useState,useSyncExternalStore} from "react";
import type {VideoConfig} from "@/types/lyrics";
import {CloudExportClient,cloudActive} from "@/lib/cloud-export-client";
const labels={queued:"Auftrag gespeichert",preparing:"Private Medien vorbereiten",starting:"Cloud-Start wird bestätigt",rendering:"Cloud rendert",cancelling:"Abbruch angefordert – Bestätigung ausstehend",succeeded:"Video bereit",failed:"Export fehlgeschlagen",cancelled:"Abbruch bestätigt", "needs-attention":"Start unklar – manuelle Prüfung nötig"};
export function CloudExport({config}:{config:VideoConfig}){
 const [client]=useState(()=>new CloudExportClient());const state=useSyncExternalStore(client.subscribe,client.getSnapshot,client.getSnapshot);
 const [ready,setReady]=useState(false),[checked,setChecked]=useState(false),[remaining,setRemaining]=useState(0);
 useEffect(()=>{let alive=true;void fetch("/api/session",{cache:"no-store"}).then(response=>response.json()).then(body=>{if(alive){setReady(body.cloudReady===true);setRemaining(body.cloudMaxStarts??0);setChecked(true);}}).catch(()=>{if(alive)setChecked(true);});void client.refresh();const timer=setInterval(()=>void client.refresh(),3000);return()=>{alive=false;clearInterval(timer);};},[client]);
 const seconds=config.durationInFrames/config.fps,tooLong=seconds>30;
 const job=state.job,active=cloudActive(job);
 return <div className="flex flex-col gap-3 rounded-xl border border-white/15 p-3">
  <p className="text-sm text-white/75">Cloud-Pilot: 720p · 24 fps · bis 30 Sekunden · Standardschrift.</p>
  {!checked?<p className="text-sm text-white/50">Einrichtung prüfen…</p>:!ready?<p className="text-sm text-amber-200">Cloud noch nicht freigeschaltet. Lokal exportieren bleibt verfügbar.</p>:<p className="text-xs text-white/50">{remaining>0?"Ein genehmigter Testversuch verbleibt.":"Das genehmigte Testbudget ist verbraucht."} Eingaben sind kurzlebig; das Video liegt privat in R2.</p>}
  {tooLong&&<p className="text-sm text-amber-200">Dieses Video ist länger als 30 Sekunden. Bitte lokal exportieren.</p>}
  {job&&<div role="status" aria-live="polite"><p className="text-sm text-white">{labels[job.state]}</p><progress className="mt-2 w-full" value={job.progress} max={1}/><p className="text-xs text-white/50">{Math.round(job.progress*100)}%</p>
   {job.errorCode&&<p className="mt-2 text-sm text-amber-200">{job.errorCode==="preflight-failed"?"Einrichtung, AWS-Anmeldung und Eingaben prüfen. Es wurde kein Lambda-Testversuch verbraucht.":job.errorCode==="invocation-uncertain"?"Kein zweiter Cloud-Start. Bitte den vorhandenen Auftrag prüfen lassen.":job.errorCode==="render-failed"?"Cloud-Export fehlgeschlagen. Lokal exportieren ist weiterhin möglich.":"Verbindung oder Abbruch noch ausstehend. Status wird weiter abgefragt."}</p>}
   {job.cleanupPending&&<p className="text-xs text-white/50">Temporäre Daten werden noch bereinigt.</p>}
  </div>}
  {active&&job&&job.state!=="needs-attention"&&<button disabled={Boolean(state.pending)||job.state==="cancelling"} onClick={()=>void client.cancel()} className="rounded-lg border border-white/20 px-4 py-2 text-sm disabled:opacity-40">{job.state==="cancelling"?"Abbruch wird bestätigt…":"Cloud-Export abbrechen"}</button>}
  {job?.downloadReady&&<button disabled={Boolean(state.pending)} onClick={()=>void client.downloadPath().then(url=>{if(url){const a=document.createElement("a");a.href=boundMediaUrl(url);a.download="lyrica-720p.mp4";a.rel="noreferrer";a.click();}})} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black">Privates Video herunterladen</button>}
  {!active&&!job?.downloadReady&&<button disabled={!ready||remaining<1||tooLong||Boolean(state.pending)} onClick={()=>void client.start({...config,renderQuality:"fast"} as unknown as Record<string,unknown>)} className="rounded-xl bg-white px-6 py-3 text-sm font-semibold text-black disabled:opacity-40">{state.pending==="start"?"Auftrag speichern…":"In der Cloud exportieren"}</button>}
  {state.error&&<p role="alert" className="text-sm text-red-300">{state.error}</p>}
 </div>;
}

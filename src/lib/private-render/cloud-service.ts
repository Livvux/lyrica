import {CloudJobs} from "./cloud-jobs";
import {productionCloudAdapter} from "./cloud-adapter";
import {getStore} from "./server";
let service:CloudJobs|null=null;
export function getCloudJobs():CloudJobs {
 if(!service){service=new CloudJobs(getStore(),productionCloudAdapter());
  const timer=setInterval(()=>{for(const id of service!.activeIds())void service!.advance(id).catch(()=>{});},5000);timer.unref();
 }
 return service;
}

import {NextResponse,type NextRequest} from "next/server";
import {requireActor,privateFailure} from "./lib/private-render/server";
export function proxy(request:NextRequest) {
 try {requireActor(request,!["GET","HEAD","OPTIONS"].includes(request.method));return NextResponse.next();}
 catch(error){return privateFailure(error);}
}
export const config={matcher:["/api/((?!session(?:/|$)).*)"]};

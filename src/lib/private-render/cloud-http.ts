import {PrivateError,privateFailure} from "./server";
export function cloudFailure(error:unknown):Response {
 if(error instanceof PrivateError)return privateFailure(error);
 const message=error instanceof Error?error.message:"";
 if(message==="Nicht gefunden.")return privateFailure(new PrivateError(404,message));
 if(/Konflikt:|Export läuft|Testbudget|Privater Speicher voll/.test(message))return privateFailure(new PrivateError(409,message));
 return privateFailure(new PrivateError(503,"Cloud-Export derzeit nicht verfügbar. Einrichtung und AWS-Anmeldung prüfen."));
}
export const privateHeaders={"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"};

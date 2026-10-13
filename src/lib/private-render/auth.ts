import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { PrivateStore } from "./store";

export function hashPassword(password: string): string {
  if (password.length < 12 || password.length > 256) throw new Error("Password must be 12-256 characters");
  const salt = randomBytes(32).toString("hex");
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyPassword(password: string, hash: string): boolean {
  if (password.length > 256) return false;
  const [kind, salt, value] = hash.split(":");
  if (kind !== "scrypt" || !/^[a-f0-9]{64}$/.test(salt ?? "") || !/^[a-f0-9]{128}$/.test(value ?? "")) return false;
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(value, "hex"));
}
export function cookieValue(request: Request, name: string): string {
  const prefix = `${name}=`;
  return request.headers.get("cookie")?.split(";").map(x => x.trim()).find(x => x.startsWith(prefix))?.slice(prefix.length) ?? "";
}
const equal = (a: string, b: string) => timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
export function authenticate(request: Request, store: PrivateStore, options: {ownerId: string; desktopToken?: string; desktopOrigin?: string}): string | null {
  if (options.desktopToken && options.desktopOrigin && new URL(request.url).origin === options.desktopOrigin &&
      equal(cookieValue(request, "lyrica-desktop"), options.desktopToken)) return options.ownerId;
  return store.sessionOwner(cookieValue(request, "lyrica-private"));
}
export function assertMutationOrigin(request: Request, allowedOrigins: string[]) {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins.includes(origin) || request.headers.get("sec-fetch-site") === "cross-site") throw new Error("Invalid request origin");
}

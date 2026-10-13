import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync, existsSync, lstatSync } from "node:fs";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";

export type Actor = { ownerId: string; projectId: string };
export type Project = { id: string; ownerId: string; name: string };
export type MediaRecord = Actor & { id: string; filename: string; contentType: string; size: number; objectKey: string | null };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const PROJECT_COLUMNS = "id, owner_id AS ownerId, name";
const MEDIA_COLUMNS = "id, owner_id AS ownerId, project_id AS projectId, filename, content_type AS contentType, size, object_key AS objectKey";

export class PrivateStore {
  readonly db: DatabaseSync;
  readonly directory: string;
  constructor(directory: string) {
    this.directory = path.resolve(directory);
    if (existsSync(this.directory) && lstatSync(this.directory).isSymbolicLink()) throw new Error("Private data directory cannot be a symlink");
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    chmodSync(this.directory, 0o700);
    const filename = path.join(this.directory, "private.sqlite");
    if (existsSync(filename) && lstatSync(filename).isSymbolicLink()) throw new Error("Private database cannot be a symlink");
    this.db = new DatabaseSync(filename);
    chmodSync(filename, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS projects_owner ON projects(owner_id);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, owner_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id),
        filename TEXT UNIQUE NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL, object_key TEXT);
      CREATE TABLE IF NOT EXISTS limits(key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS cloud_jobs(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,project_id TEXT NOT NULL REFERENCES projects(id),
      request_key TEXT NOT NULL,config_hash TEXT NOT NULL,config_json TEXT NOT NULL,state TEXT NOT NULL,render_id TEXT,
      progress REAL NOT NULL DEFAULT 0,error_code TEXT,output_bytes INTEGER NOT NULL DEFAULT 0,reserved_bytes INTEGER NOT NULL DEFAULT 0,
      cleanup_pending INTEGER NOT NULL DEFAULT 0,slot_reserved INTEGER NOT NULL DEFAULT 1,attempt_consumed INTEGER NOT NULL DEFAULT 0,
      cancel_requested INTEGER NOT NULL DEFAULT 0,cancel_sent INTEGER NOT NULL DEFAULT 0,lease_until INTEGER NOT NULL DEFAULT 0,
      invoked_at INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(owner_id,project_id,request_key));
      CREATE UNIQUE INDEX IF NOT EXISTS cloud_exclusive_slot ON cloud_jobs(slot_reserved) WHERE slot_reserved=1;`);
    if(!this.db.prepare("PRAGMA table_info(cloud_jobs)").all().some(row=>row.name==="invoked_at"))this.db.exec("ALTER TABLE cloud_jobs ADD COLUMN invoked_at INTEGER NOT NULL DEFAULT 0");
    if(!this.db.prepare("PRAGMA table_info(media)").all().some(row=>row.name==="state"))this.db.exec("ALTER TABLE media ADD COLUMN state TEXT NOT NULL DEFAULT 'ready'");
  }
  close() { this.db.close(); }
  checkpoint() { this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); }
  transaction<T>(run: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = run(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  projects(ownerId: string): Project[] {
    return this.db.prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE owner_id=? ORDER BY rowid`).all(ownerId) as unknown as Project[];
  }
  project(ownerId: string, id: string): Project | null {
    return this.db.prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE owner_id=? AND id=?`).get(ownerId, id) as unknown as Project ?? null;
  }
  createProject(ownerId: string, name: string): Project {
    if (!name.trim() || name.length > 80) throw new Error("Invalid project name");
    const result = { id: randomUUID(), ownerId, name: name.trim() };
    this.db.prepare("INSERT INTO projects(id,owner_id,name) VALUES(?,?,?)").run(result.id, ownerId, result.name);
    return result;
  }
  defaultProject(ownerId: string): Project {
    return this.transaction(() => this.projects(ownerId)[0] ?? this.createProject(ownerId, "Lyrica"));
  }
  createSession(ownerId: string, ttlMs: number, now = Date.now()): string {
    const token = randomBytes(32).toString("hex");
    this.db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(digest(token), ownerId, now + ttlMs);
    return token;
  }
  sessionOwner(token: string, now = Date.now()): string | null {
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    const row = this.db.prepare("SELECT owner_id FROM sessions WHERE token_hash=? AND expires_at>?").get(digest(token), now);
    return row ? String(row.owner_id) : null;
  }
  revokeSession(token: string) { this.db.prepare("DELETE FROM sessions WHERE token_hash=?").run(digest(token)); }
  registerMedia(actor: Actor, data: Omit<MediaRecord, keyof Actor | "id">): MediaRecord {
    if (!this.project(actor.ownerId, actor.projectId)) throw new Error("Project unavailable");
    if (!/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(data.filename) || !Number.isSafeInteger(data.size) || data.size <= 0) throw new Error("Invalid media");
    const result = { ...actor, ...data, id: randomUUID() };
    this.db.prepare("INSERT INTO media(id,owner_id,project_id,filename,content_type,size,object_key) VALUES(?,?,?,?,?,?,?)").run(result.id, actor.ownerId, actor.projectId, data.filename, data.contentType, data.size, data.objectKey);
    return result;
  }
  media(actor: Actor, filename: string): MediaRecord | null {
    return this.db.prepare(`SELECT ${MEDIA_COLUMNS} FROM media WHERE owner_id=? AND project_id=? AND filename=? AND state='ready'`).get(actor.ownerId, actor.projectId, filename) as unknown as MediaRecord ?? null;
  }
  markMediaCleanupPending(actor:Actor,filename:string){this.db.prepare("UPDATE media SET state='cleanup-pending' WHERE owner_id=? AND project_id=? AND filename=?").run(actor.ownerId,actor.projectId,filename);}
  pendingMediaCleanup():MediaRecord[]{return this.db.prepare(`SELECT ${MEDIA_COLUMNS} FROM media WHERE state='cleanup-pending'`).all() as unknown as MediaRecord[];}
  removeMedia(actor:Actor,filename:string) {this.db.prepare("DELETE FROM media WHERE owner_id=? AND project_id=? AND filename=?").run(actor.ownerId,actor.projectId,filename);}
  retainedMediaBytes():number {return Number(this.db.prepare("SELECT COALESCE(SUM(size),0)+(SELECT COALESCE(SUM(reserved_bytes),0) FROM cloud_jobs) AS bytes FROM media").get()!.bytes);}
  cloudStartsRemaining():number{return Math.max(0,1-Number(this.db.prepare("SELECT COUNT(*) AS count FROM cloud_jobs WHERE attempt_consumed=1").get()!.count));}
  consumeLimit(key: string, maximum: number, windowMs: number, now = Date.now()): boolean {
    return this.transaction(() => {
      const row = this.db.prepare("SELECT count,reset_at FROM limits WHERE key=?").get(key);
      if (row && Number(row.reset_at) > now && Number(row.count) >= maximum) return false;
      const count = row && Number(row.reset_at) > now ? Number(row.count) + 1 : 1;
      const reset = row && Number(row.reset_at) > now ? Number(row.reset_at) : now + windowMs;
      this.db.prepare("INSERT INTO limits VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,reset_at=excluded.reset_at").run(key, count, reset);
      return true;
    });
  }
}

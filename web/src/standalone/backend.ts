// In-browser backend for the standalone build: runs the real server routes and workflow
// against SQLite compiled to plain JavaScript (sql.js asm build, no WebAssembly), and
// keeps the database in this browser's IndexedDB.

import initSqlJs from 'sql.js/dist/sql-asm-memory-growth.js';
import type { Database, SqlValue } from 'sql.js';
import { SCHEMA, setDb } from '../../../server/src/db';
import { dispatch, resolveUser } from '../../../server/src/routes';
import { seed } from '../../../server/src/seed';
import { WorkflowError } from '../../../server/src/services/workflow';

const IDB_NAME = 'prebind-center';
const IDB_STORE = 'db';
const IDB_KEY = 'main';

type Param = string | number | boolean | null | undefined;
const toSql = (p: Param[]): SqlValue[] => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));

/** Minimal node:sqlite DatabaseSync look-alike over sql.js, enough for the shared server code. */
class SqlJsAdapter {
  constructor(private db: Database) {}
  exec(sql: string) {
    this.db.exec(sql);
  }
  prepare(sql: string) {
    const db = this.db;
    return {
      get(...params: Param[]) {
        const s = db.prepare(sql);
        try {
          s.bind(toSql(params));
          return s.step() ? s.getAsObject() : undefined;
        } finally {
          s.free();
        }
      },
      all(...params: Param[]) {
        const s = db.prepare(sql);
        try {
          s.bind(toSql(params));
          const out: Record<string, SqlValue>[] = [];
          while (s.step()) out.push(s.getAsObject());
          return out;
        } finally {
          s.free();
        }
      },
      run(...params: Param[]) {
        db.run(sql, toSql(params));
        const changes = db.getRowsModified();
        const id = db.exec('SELECT last_insert_rowid()')[0]?.values[0][0] ?? 0;
        return { lastInsertRowid: Number(id), changes };
      },
    };
  }
}

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadSaved(): Promise<Uint8Array | null> {
  try {
    const d = await idb();
    return await new Promise((resolve) => {
      const req = d.transaction(IDB_STORE).objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve((req.result as Uint8Array) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function save(bytes: Uint8Array | null) {
  try {
    const d = await idb();
    const store = d.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE);
    if (bytes) store.put(bytes, IDB_KEY);
    else store.delete(IDB_KEY);
  } catch {
    // Storage blocked (private window etc.): the app still works for this session.
  }
}

let sqlDb: Database | null = null;
let ready: Promise<void> | null = null;

async function boot(fresh: boolean) {
  const SQL = await initSqlJs();
  const saved = fresh ? null : await loadSaved();
  sqlDb = saved ? new SQL.Database(saved) : new SQL.Database();
  const adapter = new SqlJsAdapter(sqlDb);
  adapter.exec('PRAGMA foreign_keys = ON;');
  adapter.exec(SCHEMA);
  setDb(adapter as never);
  const users = adapter.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  if (!users.n) {
    seed();
    await save(sqlDb.export());
  }
}

function ensureReady() {
  if (!ready) ready = boot(false);
  return ready;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function persistSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => sqlDb && save(sqlDb.export()), 200);
}

/** Wipe this browser's data and reload the sample submissions. */
export async function resetDemoData() {
  await ensureReady();
  sqlDb?.close();
  await save(null);
  ready = boot(true);
  await ready;
}

const readFile = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });

export class LocalApiError extends Error {
  constructor(message: string, public status: number, public details?: unknown) {
    super(message);
  }
}

export async function localApi(method: string, pathWithQuery: string, userId: number, body?: unknown, form?: FormData): Promise<unknown> {
  await ensureReady();
  const url = new URL(pathWithQuery, 'http://local');
  const user = resolveUser(userId);
  if (!user) throw new LocalApiError('No users configured', 500);
  let reqBody = body ?? {};
  let file;
  if (form) {
    const f = form.get('file');
    reqBody = Object.fromEntries([...form.entries()].filter(([k]) => k !== 'file'));
    if (f instanceof File) file = { name: f.name, mimeType: f.type || 'application/octet-stream', size: f.size, storagePath: await readFile(f) };
  }
  try {
    const out = dispatch(method, url.pathname, { query: Object.fromEntries(url.searchParams), body: reqBody, user, file });
    if (method !== 'GET') persistSoon();
    return JSON.parse(JSON.stringify(out ?? null));
  } catch (e) {
    if (e instanceof WorkflowError) throw new LocalApiError(e.message, e.status, e.details);
    throw new LocalApiError((e as Error)?.message ?? 'Unexpected error', 500);
  }
}

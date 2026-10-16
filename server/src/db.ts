import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Account, Producer, Submission, User, UWIssue, Version } from './types.js';

type DatabaseSync = DatabaseSyncType;

let db: DatabaseSync | null = null;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  authority_level INTEGER NOT NULL,
  email TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS producers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  contact_name TEXT, email TEXT, phone TEXT, city TEXT, state TEXT,
  licensed_states TEXT NOT NULL,
  commission_pct REAL NOT NULL DEFAULT 15,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_number TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL, dba TEXT, fein TEXT, entity_type TEXT, naics TEXT, industry TEXT,
  address1 TEXT, city TEXT, state TEXT, zip TEXT, website TEXT,
  years_in_business INTEGER, annual_revenue REAL, employee_count INTEGER,
  contact_name TEXT, contact_email TEXT, contact_phone TEXT,
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_number TEXT UNIQUE NOT NULL,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  producer_id INTEGER NOT NULL REFERENCES producers(id),
  product TEXT NOT NULL,
  status TEXT NOT NULL,
  underwriter_id INTEGER REFERENCES users(id),
  effective_date TEXT NOT NULL,
  expiration_date TEXT NOT NULL,
  received_date TEXT NOT NULL,
  source TEXT, priority TEXT, description TEXT,
  clearance_json TEXT, scan_json TEXT,
  decline_reason TEXT,
  selected_version_id INTEGER,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL REFERENCES submissions(id),
  version_no INTEGER NOT NULL,
  name TEXT NOT NULL,
  risk_json TEXT NOT NULL,
  pricing_json TEXT,
  status TEXT NOT NULL DEFAULT 'Draft',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS uw_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL REFERENCES submissions(id),
  version_id INTEGER NOT NULL REFERENCES versions(id),
  code TEXT NOT NULL,
  short_description TEXT NOT NULL,
  long_description TEXT NOT NULL,
  blocking_point TEXT NOT NULL,
  required_authority INTEGER NOT NULL,
  value TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Open',
  decided_by TEXT, decided_at TEXT, decision_note TEXT,
  subjectivity TEXT
);
CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL REFERENCES submissions(id),
  version_id INTEGER NOT NULL REFERENCES versions(id),
  quote_number TEXT UNIQUE NOT NULL,
  premium REAL NOT NULL,
  total_cost REAL NOT NULL,
  valid_until TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER, account_id INTEGER,
  topic TEXT NOT NULL, subject TEXT, body TEXT NOT NULL,
  author TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER, account_id INTEGER,
  subject TEXT NOT NULL, description TEXT,
  assigned_to INTEGER REFERENCES users(id),
  priority TEXT NOT NULL DEFAULT 'Normal',
  due_date TEXT, status TEXT NOT NULL DEFAULT 'Open',
  created_at TEXT NOT NULL, completed_at TEXT
);
CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER, account_id INTEGER,
  event TEXT NOT NULL, detail TEXT, user_name TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL,
  name TEXT NOT NULL, doc_type TEXT NOT NULL, mime_type TEXT,
  size INTEGER, storage_path TEXT, quote_id INTEGER,
  uploaded_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sequences (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
`;

export function initDb(file = process.env.DB_PATH ?? path.resolve('data', 'prebind.db')): DatabaseSync {
  // Loaded via require (and only here) so vite-node and the browser build never bundle the node:sqlite builtin.
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

/** Use an already-open database (the in-browser build supplies a sql.js-backed adapter). */
export function setDb(d: DatabaseSync) {
  db = d;
}

export function getDb(): DatabaseSync {
  if (!db) initDb();
  return db!;
}

export function now(): string {
  return new Date().toISOString();
}

export function nextSequence(name: string, start = 1000): number {
  const d = getDb();
  const row = d.prepare('SELECT value FROM sequences WHERE name = ?').get(name) as { value: number } | undefined;
  const value = (row?.value ?? start) + 1;
  d.prepare('INSERT INTO sequences(name, value) VALUES(?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value').run(name, value);
  return value;
}

export function transaction<T>(fn: () => T): T {
  const d = getDb();
  d.exec('BEGIN');
  try {
    const result = fn();
    d.exec('COMMIT');
    return result;
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

type Row = Record<string, any>;

const json = <T>(s: unknown): T | null => (s ? (JSON.parse(String(s)) as T) : null);

export const mapUser = (r: Row): User => ({
  id: r.id, username: r.username, name: r.name, role: r.role, authorityLevel: r.authority_level, email: r.email,
});

export const mapProducer = (r: Row): Producer => ({
  id: r.id, code: r.code, name: r.name, contactName: r.contact_name, email: r.email, phone: r.phone,
  city: r.city, state: r.state, licensedStates: JSON.parse(r.licensed_states), commissionPct: r.commission_pct, active: !!r.active,
});

export const mapAccount = (r: Row): Account => ({
  id: r.id, accountNumber: r.account_number, name: r.name, dba: r.dba ?? '', fein: r.fein ?? '', entityType: r.entity_type ?? '',
  naics: r.naics ?? '', industry: r.industry ?? '', address1: r.address1 ?? '', city: r.city ?? '', state: r.state ?? '', zip: r.zip ?? '',
  website: r.website ?? '', yearsInBusiness: r.years_in_business ?? 0, annualRevenue: r.annual_revenue ?? 0, employeeCount: r.employee_count ?? 0,
  contactName: r.contact_name ?? '', contactEmail: r.contact_email ?? '', contactPhone: r.contact_phone ?? '', status: r.status, createdAt: r.created_at,
});

export const mapSubmission = (r: Row): Submission => ({
  id: r.id, jobNumber: r.job_number, accountId: r.account_id, producerId: r.producer_id, product: r.product, status: r.status,
  underwriterId: r.underwriter_id, effectiveDate: r.effective_date, expirationDate: r.expiration_date, receivedDate: r.received_date,
  source: r.source ?? '', priority: r.priority ?? 'Normal', description: r.description ?? '',
  clearance: json(r.clearance_json), scan: json(r.scan_json), declineReason: r.decline_reason,
  selectedVersionId: r.selected_version_id, createdAt: r.created_at, updatedAt: r.updated_at,
});

export const mapVersion = (r: Row): Version => ({
  id: r.id, submissionId: r.submission_id, versionNo: r.version_no, name: r.name, risk: JSON.parse(r.risk_json),
  pricing: json(r.pricing_json), status: r.status, createdAt: r.created_at,
});

export const mapIssue = (r: Row): UWIssue => ({
  id: r.id, submissionId: r.submission_id, versionId: r.version_id, code: r.code, shortDescription: r.short_description,
  longDescription: r.long_description, blockingPoint: r.blocking_point, requiredAuthority: r.required_authority, value: r.value,
  status: r.status, decidedBy: r.decided_by, decidedAt: r.decided_at, decisionNote: r.decision_note, subjectivity: r.subjectivity,
});

export const repo = {
  user(id: number): User | undefined {
    const r = getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
    return r ? mapUser(r) : undefined;
  },
  users(): User[] {
    return getDb().prepare('SELECT * FROM users ORDER BY authority_level, name').all().map(mapUser);
  },
  producer(id: number): Producer | undefined {
    const r = getDb().prepare('SELECT * FROM producers WHERE id = ?').get(id);
    return r ? mapProducer(r) : undefined;
  },
  producers(): Producer[] {
    return getDb().prepare('SELECT * FROM producers ORDER BY name').all().map(mapProducer);
  },
  account(id: number): Account | undefined {
    const r = getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(id);
    return r ? mapAccount(r) : undefined;
  },
  accounts(): Account[] {
    return getDb().prepare('SELECT * FROM accounts ORDER BY name').all().map(mapAccount);
  },
  submission(id: number): Submission | undefined {
    const r = getDb().prepare('SELECT * FROM submissions WHERE id = ?').get(id);
    return r ? mapSubmission(r) : undefined;
  },
  submissions(where = '1=1', ...params: (string | number)[]): Submission[] {
    return getDb().prepare(`SELECT * FROM submissions WHERE ${where} ORDER BY id DESC`).all(...params).map(mapSubmission);
  },
  version(id: number): Version | undefined {
    const r = getDb().prepare('SELECT * FROM versions WHERE id = ?').get(id);
    return r ? mapVersion(r) : undefined;
  },
  versions(submissionId: number): Version[] {
    return getDb().prepare('SELECT * FROM versions WHERE submission_id = ? ORDER BY version_no').all(submissionId).map(mapVersion);
  },
  issues(submissionId: number, versionId?: number): UWIssue[] {
    const d = getDb();
    const rows = versionId
      ? d.prepare('SELECT * FROM uw_issues WHERE submission_id = ? AND version_id = ? ORDER BY id').all(submissionId, versionId)
      : d.prepare('SELECT * FROM uw_issues WHERE submission_id = ? ORDER BY id').all(submissionId);
    return rows.map(mapIssue);
  },
  updateSubmission(id: number, fields: Record<string, unknown>) {
    const cols = Object.keys(fields);
    if (!cols.length) return;
    const sets = cols.map((c) => `${c} = ?`).join(', ');
    const values = cols.map((c) => {
      const v = fields[c];
      return v !== null && typeof v === 'object' ? JSON.stringify(v) : (v as any);
    });
    getDb().prepare(`UPDATE submissions SET ${sets}, updated_at = ? WHERE id = ?`).run(...values, now(), id);
  },
  history(submissionId: number | null, accountId: number | null, event: string, detail: string, userName: string) {
    getDb().prepare('INSERT INTO history(submission_id, account_id, event, detail, user_name, created_at) VALUES(?,?,?,?,?,?)')
      .run(submissionId, accountId, event, detail, userName, now());
  },
  activity(a: { submissionId?: number | null; accountId?: number | null; subject: string; description?: string; assignedTo: number | null; priority?: string; dueDate?: string }) {
    getDb().prepare('INSERT INTO activities(submission_id, account_id, subject, description, assigned_to, priority, due_date, created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(a.submissionId ?? null, a.accountId ?? null, a.subject, a.description ?? '', a.assignedTo, a.priority ?? 'Normal', a.dueDate ?? null, now());
  },
};

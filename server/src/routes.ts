// Framework-independent API routes, shared by the Express server and the in-browser standalone build.

import { getDb, mapAccount, now, repo } from './db.js';
import { PRODUCTS, referenceData } from './products/index.js';
import { nameSimilarity } from './services/clearance.js';
import { validateRisk } from './services/validation.js';
import * as wf from './services/workflow.js';
import * as pol from './services/policy.js';
import { JOB_TYPE_LABELS, STATUS_LABELS, type Account, type Product, type User } from './types.js';

export interface RouteRequest {
  params: Record<string, string>;
  query: Record<string, string | undefined>;
  body: any;
  user: User;
  /** Uploaded file metadata (documents route). */
  file?: { name: string; mimeType: string; size: number; storagePath: string };
}

export interface Route {
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  regex: RegExp;
  keys: string[];
  handler: (req: RouteRequest) => unknown;
}

export const routes: Route[] = [];

function r(method: Route['method'], path: string, handler: Route['handler']) {
  const keys: string[] = [];
  const regex = new RegExp('^' + path.replace(/:(\w+)/g, (_m, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, path, regex, keys, handler });
}

/** Resolve the acting user from a user id (the UI's user switcher). Defaults to the first underwriter. */
export function resolveUser(uid: number): User | undefined {
  return (uid && repo.user(uid)) || repo.users().find((u) => u.role === 'Underwriter') || repo.users()[0];
}

/** Find and run the route for a method + path (path without the /api prefix). */
export function dispatch(method: string, path: string, req: Omit<RouteRequest, 'params'>): unknown {
  for (const route of routes) {
    if (route.method !== method) continue;
    const m = route.regex.exec(path);
    if (!m) continue;
    const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    return route.handler({ ...req, params });
  }
  throw new wf.WorkflowError('Not found', 404);
}

export function submissionDetail(subId: number) {
  const sub = repo.submission(subId);
  if (!sub) throw new wf.WorkflowError('Submission not found', 404);
  const d = getDb();
  const versions = repo.versions(subId);
  const selected = versions.find((v) => v.id === sub.selectedVersionId) ?? versions[0];
  // Quotes issued before subjectivity tracking existed get their checklist on first view.
  if ((sub.jobType === 'Submission' || sub.jobType === 'Renewal') && sub.status === 'QUOTED' && selected && !pol.subjectivities(subId).length) {
    pol.syncSubjectivities(sub, selected.id);
  }
  return {
    submission: { ...sub, statusLabel: STATUS_LABELS[sub.status] },
    account: repo.account(sub.accountId),
    producer: repo.producer(sub.producerId),
    underwriter: sub.underwriterId ? repo.user(sub.underwriterId) : null,
    versions,
    selectedVersionId: selected?.id,
    issues: repo.issues(subId),
    validation: selected ? validateRisk(selected.risk) : [],
    quoteBlockers: selected ? wf.quoteBlockers(sub, selected) : [],
    subjectivities: selected ? wf.subjectivitiesFor(sub, selected.id) : [],
    subjectivityItems: pol.subjectivities(subId),
    jobTypeLabel: JOB_TYPE_LABELS[sub.jobType],
    policy: sub.policyId ? { id: sub.policyId, policyNumber: pol.getPolicy(sub.policyId).policyNumber, status: pol.policyStatus(sub.policyId) } : null,
    premiumSummary: pol.premiumSummary(sub, selected),
    basePeriod: pol.basePeriodOf(sub) ?? null,
    bindBlockers: pol.bindBlockers(sub),
    paymentPlans: pol.PAYMENT_PLANS,
    billingMethods: pol.BILLING_METHODS,
    quotes: d.prepare('SELECT id, version_id AS versionId, quote_number AS quoteNumber, premium, total_cost AS totalCost, valid_until AS validUntil, status, created_by AS createdBy, created_at AS createdAt FROM quotes WHERE submission_id = ? ORDER BY id DESC').all(subId),
    documents: d.prepare('SELECT id, name, doc_type AS docType, mime_type AS mimeType, size, quote_id AS quoteId, policy_id AS policyId, (doc_json IS NOT NULL) AS viewable, uploaded_by AS uploadedBy, created_at AS createdAt FROM documents WHERE submission_id = ? ORDER BY id DESC').all(subId),
    notes: d.prepare('SELECT * FROM notes WHERE submission_id = ? ORDER BY id DESC').all(subId),
    activities: d.prepare('SELECT a.*, u.name AS assigned_name FROM activities a LEFT JOIN users u ON u.id = a.assigned_to WHERE submission_id = ? ORDER BY a.id DESC').all(subId),
    history: d.prepare('SELECT * FROM history WHERE submission_id = ? ORDER BY id DESC').all(subId),
  };
}

function submissionRows(where: string, params: (string | number)[], limit = 200) {
  return getDb()
    .prepare(`SELECT s.id, s.job_number AS jobNumber, s.job_type AS jobType, s.product, s.status, s.effective_date AS effectiveDate, s.received_date AS receivedDate,
        s.priority, s.updated_at AS updatedAt, a.id AS accountId, a.name AS accountName, a.account_number AS accountNumber, a.state,
        p.name AS producerName, u.name AS underwriterName,
        (SELECT pricing_json IS NOT NULL FROM versions v WHERE v.id = s.selected_version_id) AS rated,
        (SELECT json_extract(pricing_json, '$.premium') FROM versions v WHERE v.id = s.selected_version_id) AS premium
      FROM submissions s JOIN accounts a ON a.id = s.account_id JOIN producers p ON p.id = s.producer_id LEFT JOIN users u ON u.id = s.underwriter_id
      WHERE ${where} ORDER BY s.updated_at DESC LIMIT ${limit}`)
    .all(...params)
    .map((r: any) => ({ ...r, statusLabel: STATUS_LABELS[r.status as keyof typeof STATUS_LABELS], productName: PRODUCTS[r.product as Product]?.name, jobTypeLabel: JOB_TYPE_LABELS[r.jobType as keyof typeof JOB_TYPE_LABELS] ?? 'Submission' }));
}

// ------------------------------------------------------------ reference & admin
r('GET', '/reference', () => referenceData());
r('GET', '/me', (req) => req.user);
r('GET', '/users', () => repo.users());
r('GET', '/producers', () => repo.producers());
r('POST', '/producers', (req) => {
  if (req.user.role !== 'Administrator') throw new wf.WorkflowError('Administrator only', 403);
  const p = req.body;
  if (!p.code || !p.name) throw new wf.WorkflowError('Code and name are required');
  const r = getDb().prepare('INSERT INTO producers(code, name, contact_name, email, phone, city, state, licensed_states, commission_pct, active) VALUES(?,?,?,?,?,?,?,?,?,1)')
    .run(p.code, p.name, p.contactName ?? '', p.email ?? '', p.phone ?? '', p.city ?? '', p.state ?? '', JSON.stringify(p.licensedStates ?? []), Number(p.commissionPct) || 15);
  return repo.producer(Number(r.lastInsertRowid));
});

// ------------------------------------------------------------ desktop
r('GET', '/desktop', (req) => {
  const uid = req.user.id;
  const d = getDb();
  const counts = d.prepare("SELECT status, COUNT(*) AS n FROM submissions GROUP BY status").all() as { status: string; n: number }[];
  return {
    counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
    mySubmissions: submissionRows("s.underwriter_id = ? AND s.status NOT IN ('DECLINED','WITHDRAWN')", [uid], 50),
    clearanceQueue: submissionRows("s.status IN ('INTAKE','CLEARANCE_REFERRAL')", [], 50),
    myActivities: d.prepare(`SELECT a.*, s.job_number AS jobNumber, acc.name AS accountName FROM activities a
      LEFT JOIN submissions s ON s.id = a.submission_id LEFT JOIN accounts acc ON acc.id = s.account_id
      WHERE a.assigned_to = ? AND a.status = 'Open' ORDER BY a.due_date IS NULL, a.due_date, a.id`).all(uid),
    renewalsDue: (d.prepare('SELECT id FROM policies').all() as { id: number }[])
      .map((p) => pol.policySummaryRow(pol.getPolicy(p.id)))
      .filter((p) => p.periodEnd && p.status !== 'Canceled' && pol.daysBetween(pol.today(), p.periodEnd) <= 90 && !pol.policyDetail(p.id).renewal),
    policyCount: (d.prepare('SELECT COUNT(*) AS n FROM policies').get() as { n: number }).n,
    recentQuotes: d.prepare(`SELECT q.id, q.quote_number AS quoteNumber, q.premium, q.valid_until AS validUntil, q.created_at AS createdAt, s.id AS submissionId,
      s.job_number AS jobNumber, s.product, a.name AS accountName FROM quotes q JOIN submissions s ON s.id = q.submission_id JOIN accounts a ON a.id = s.account_id
      WHERE q.status = 'Active' ORDER BY q.id DESC LIMIT 10`).all(),
  };
});

// ------------------------------------------------------------ accounts
r('GET', '/accounts', (req) => {
  const q = String(req.query.q ?? '').trim();
  if (!q) return getDb().prepare('SELECT * FROM accounts ORDER BY id DESC LIMIT 100').all().map(mapAccount);
  const like = `%${q}%`;
  return getDb().prepare('SELECT * FROM accounts WHERE name LIKE ? OR dba LIKE ? OR account_number LIKE ? OR fein LIKE ? OR city LIKE ? ORDER BY name LIMIT 100')
    .all(like, like, like, like, like).map(mapAccount);
});
/** Intake account match: fuzzy name / FEIN search used before creating a new account. */
r('POST', '/accounts/match', (req) => {
  const { name = '', fein = '' } = req.body as Partial<Account>;
  return repo.accounts()
    .map((a) => ({ account: a, score: fein && a.fein === fein ? 1 : nameSimilarity(a.name, name) }))
    .filter((m) => m.score >= 0.5)
    .sort((x, y) => y.score - x.score)
    .slice(0, 10);
});
r('POST', '/accounts', (req) => wf.createAccount(req.body, req.user));
r('GET', '/accounts/:id', (req) => {
  const account = repo.account(Number(req.params.id));
  if (!account) throw new wf.WorkflowError('Account not found', 404);
  return {
    account,
    submissions: submissionRows('s.account_id = ?', [account.id]),
    policies: (getDb().prepare('SELECT id FROM policies WHERE account_id = ? ORDER BY id').all(account.id) as { id: number }[]).map((p) => pol.policySummaryRow(pol.getPolicy(p.id))),
    history: getDb().prepare('SELECT * FROM history WHERE account_id = ? ORDER BY id DESC LIMIT 50').all(account.id),
  };
});
r('PUT', '/accounts/:id', (req) => wf.updateAccount(Number(req.params.id), req.body, req.user));

// ------------------------------------------------------------ submissions
r('GET', '/submissions', (req) => {
  const where: string[] = ['1=1'];
  const params: (string | number)[] = [];
  const { q, status, product, producerId, underwriterId } = req.query as Record<string, string>;
  if (q) {
    where.push('(a.name LIKE ? OR s.job_number LIKE ? OR a.account_number LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (status) { where.push('s.status = ?'); params.push(status); }
  if (product) { where.push('s.product = ?'); params.push(product); }
  if (producerId) { where.push('s.producer_id = ?'); params.push(Number(producerId)); }
  if (underwriterId) { where.push('s.underwriter_id = ?'); params.push(Number(underwriterId)); }
  return submissionRows(where.join(' AND '), params);
});

/** New Submission wizard: one submission per selected product (PolicyCenter "New Submissions" screen). */
r('POST', '/submissions', (req) => {
  const b = req.body as { accountId?: number; newAccount?: Partial<Account>; products: Product[] } & Omit<wf.NewSubmissionInput, 'product' | 'accountId'>;
  if (!b.products?.length) throw new wf.WorkflowError('Select at least one product');
  const accountId = b.accountId ?? (b.newAccount ? wf.createAccount(b.newAccount, req.user).id : undefined);
  if (!accountId) throw new wf.WorkflowError('An account is required');
  const created = b.products.map((product) => wf.createSubmission({ ...b, accountId, product }, req.user));
  return { accountId, submissions: created };
});

/** Broker portal / ACORD-style intake API. Matches the account by FEIN or exact name, otherwise creates it. */
r('POST', '/intake', (req) => {
  const b = req.body as { account: Partial<Account>; producerCode: string; products: Product[]; effectiveDate: string; source?: string; description?: string; priority?: 'Low' | 'Normal' | 'High' | 'Rush' };
  const producer = repo.producers().find((p) => p.code === b.producerCode);
  if (!producer) throw new wf.WorkflowError(`Unknown producer code ${b.producerCode}`);
  if (!b.account?.name) throw new wf.WorkflowError('account.name is required');
  const existing = repo.accounts().find((a) => (b.account.fein && a.fein === b.account.fein) || a.name.toLowerCase() === b.account.name!.toLowerCase());
  const account = existing ?? wf.createAccount(b.account, req.user);
  const submissions = (b.products ?? []).map((product) =>
    wf.createSubmission({ accountId: account.id, producerId: producer.id, product, effectiveDate: b.effectiveDate, source: b.source ?? 'API', description: b.description, priority: b.priority }, req.user));
  return { account, matchedExistingAccount: !!existing, submissions: submissions.map((s) => ({ id: s.id, jobNumber: s.jobNumber, status: s.status, clearance: s.clearance?.outcome })) };
});

r('GET', '/submissions/:id', (req) => submissionDetail(Number(req.params.id)));
r('PUT', '/submissions/:id', (req) => { wf.updateSubmissionInfo(Number(req.params.id), req.body, req.user); return submissionDetail(Number(req.params.id)); });
r('POST', '/submissions/:id/clearance', (req) => { wf.clearSubmission(Number(req.params.id), req.user); return submissionDetail(Number(req.params.id)); });
r('POST', '/submissions/:id/clearance/override', (req) => { wf.overrideClearance(Number(req.params.id), req.body.reason, req.user); return submissionDetail(Number(req.params.id)); });
r('PUT', '/submissions/:id/versions/:vid/risk', (req) => { wf.updateRisk(Number(req.params.id), Number(req.params.vid), req.body, req.user); return submissionDetail(Number(req.params.id)); });
r('PUT', '/submissions/:id/versions/:vid', (req) => { wf.renameVersion(Number(req.params.id), Number(req.params.vid), String(req.body.name ?? '')); return submissionDetail(Number(req.params.id)); });
r('POST', '/submissions/:id/versions/:vid/copy', (req) => { wf.copyVersion(Number(req.params.id), Number(req.params.vid), req.user); return submissionDetail(Number(req.params.id)); });
r('POST', '/submissions/:id/versions/:vid/select', (req) => { wf.selectVersion(Number(req.params.id), Number(req.params.vid), req.user); return submissionDetail(Number(req.params.id)); });
r('POST', '/submissions/:id/scan', (req) => { wf.runScan(Number(req.params.id), req.user); return submissionDetail(Number(req.params.id)); });
r('POST', '/submissions/:id/evaluate', (req) => {
  const sub = repo.submission(Number(req.params.id));
  if (!sub?.selectedVersionId) throw new wf.WorkflowError('Submission not found', 404);
  wf.syncIssues(sub.id, sub.selectedVersionId);
  return submissionDetail(sub.id);
});
r('POST', '/submissions/:id/rate', (req) => { wf.rateSubmission(Number(req.params.id), req.user, req.body?.versionId); return submissionDetail(Number(req.params.id)); });
r('POST', '/submissions/:id/quote', (req) => { wf.issueQuote(Number(req.params.id), req.user); return submissionDetail(Number(req.params.id)); });
r('POST', '/submissions/:id/edit-quote', (req) => { wf.editQuote(Number(req.params.id), req.user); return submissionDetail(Number(req.params.id)); });
r('POST', '/submissions/:id/decline', (req) => { wf.declineSubmission(Number(req.params.id), req.body.reason, req.user); return submissionDetail(Number(req.params.id)); });
r('POST', '/submissions/:id/withdraw', (req) => { wf.withdrawSubmission(Number(req.params.id), req.body.reason, req.user); return submissionDetail(Number(req.params.id)); });
r('POST', '/submissions/:id/reopen', (req) => { wf.reopenSubmission(Number(req.params.id), req.user); return submissionDetail(Number(req.params.id)); });

r('POST', '/issues/:id/decision', (req) => wf.decideIssue(Number(req.params.id), req.body.decision, req.body.note ?? '', req.user));
r('POST', '/issues/:id/refer', (req) => wf.referIssue(Number(req.params.id), req.body.note ?? '', req.user));

// ------------------------------------------------------------ notes & activities
r('POST', '/submissions/:id/notes', (req) => {
  const sub = repo.submission(Number(req.params.id));
  if (!sub) throw new wf.WorkflowError('Submission not found', 404);
  if (!req.body.body?.trim()) throw new wf.WorkflowError('Note text is required');
  getDb().prepare('INSERT INTO notes(submission_id, account_id, topic, subject, body, author, created_at) VALUES(?,?,?,?,?,?,?)')
    .run(sub.id, sub.accountId, req.body.topic ?? 'General', req.body.subject ?? '', req.body.body, req.user.name, now());
  return submissionDetail(sub.id);
});
r('POST', '/submissions/:id/activities', (req) => {
  const sub = repo.submission(Number(req.params.id));
  if (!sub) throw new wf.WorkflowError('Submission not found', 404);
  if (!req.body.subject?.trim()) throw new wf.WorkflowError('Subject is required');
  repo.activity({ submissionId: sub.id, subject: req.body.subject, description: req.body.description, assignedTo: Number(req.body.assignedTo) || req.user.id, priority: req.body.priority, dueDate: req.body.dueDate });
  return submissionDetail(sub.id);
});
r('POST', '/activities/:id/complete', (req) => {
  getDb().prepare("UPDATE activities SET status='Completed', completed_at=? WHERE id=?").run(now(), Number(req.params.id));
  return { ok: true };
});

r('POST', '/submissions/:id/documents', (req) => {
  const sub = repo.submission(Number(req.params.id));
  if (!sub) throw new wf.WorkflowError('Submission not found', 404);
  if (!req.file) throw new wf.WorkflowError('No file uploaded');
  getDb().prepare('INSERT INTO documents(submission_id, name, doc_type, mime_type, size, storage_path, uploaded_by, created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(sub.id, req.file.name, String(req.body?.docType ?? 'Broker Submission'), req.file.mimeType, req.file.size, req.file.storagePath, req.user.name, now());
  repo.history(sub.id, sub.accountId, 'Document uploaded', req.file.name, req.user.name);
  return submissionDetail(sub.id);
});
r('GET', '/quotes/:id', (req) => {
  const q = getDb().prepare('SELECT * FROM quotes WHERE id = ?').get(Number(req.params.id)) as any;
  if (!q) throw new wf.WorkflowError('Quote not found', 404);
  return { id: q.id, submissionId: q.submission_id, status: q.status, snapshot: JSON.parse(q.snapshot_json) };
});

// ------------------------------------------------------------ bind & policy servicing
r('POST', '/submissions/:id/bind', (req) => { pol.bindJob(Number(req.params.id), { issue: req.body?.issue !== false }, req.user); return submissionDetail(Number(req.params.id)); });
r('POST', '/submissions/:id/non-renew', (req) => { pol.nonRenew(Number(req.params.id), req.body?.reason, req.user); return submissionDetail(Number(req.params.id)); });
r('POST', '/subjectivities/:id', (req) => pol.decideSubjectivity(Number(req.params.id), req.body?.action, req.user));

r('GET', '/policies', (req) => {
  const q = String(req.query.q ?? '').trim().toLowerCase();
  const status = req.query.status;
  return (getDb().prepare('SELECT id FROM policies ORDER BY id DESC').all() as { id: number }[])
    .map((p) => pol.policySummaryRow(pol.getPolicy(p.id)))
    .filter((p) => (!q || p.policyNumber.toLowerCase().includes(q) || p.accountName.toLowerCase().includes(q)) && (!status || p.status === status));
});
r('GET', '/policies/:id', (req) => pol.policyDetail(Number(req.params.id)));
r('POST', '/policies/:id/change', (req) => ({ jobId: pol.startPolicyChange(Number(req.params.id), req.body, req.user).id }));
r('POST', '/policies/:id/cancel', (req) => ({ jobId: pol.startCancellation(Number(req.params.id), req.body, req.user).id }));
r('POST', '/policies/:id/reinstate', (req) => ({ jobId: pol.startReinstatement(Number(req.params.id), req.body, req.user).id }));
r('POST', '/policies/:id/renew', (req) => ({ jobId: pol.startRenewal(Number(req.params.id), req.user).id }));
r('POST', '/policies/:id/issue', (req) => { pol.issuePolicy(Number(req.params.id), req.user); return pol.policyDetail(Number(req.params.id)); });
r('POST', '/invoices/:id/pay', (req) => pol.payInvoice(Number(req.params.id), req.user));
r('GET', '/documents/:id', (req) => {
  const doc = getDb().prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params.id)) as any;
  if (!doc) throw new wf.WorkflowError('Document not found', 404);
  if (!doc.doc_json) throw new wf.WorkflowError('This document has no on-screen view.', 404);
  return { id: doc.id, name: doc.name, docType: doc.doc_type, policyId: doc.policy_id, jobId: doc.submission_id, snapshot: JSON.parse(doc.doc_json) };
});

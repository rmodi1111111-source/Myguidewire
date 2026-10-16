import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, mapAccount, now, repo } from './db.js';
import { PRODUCTS, referenceData } from './products/index.js';
import { nameSimilarity } from './services/clearance.js';
import { renderQuotePdf, type QuoteSnapshot } from './services/quoteDoc.js';
import { validateRisk } from './services/validation.js';
import * as wf from './services/workflow.js';
import { STATUS_LABELS, type Account, type Product, type User } from './types.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user: User;
    }
  }
}

const id = (req: Request, key = 'id') => Number(req.params[key]);

/** Wrap sync/async handlers so thrown errors reach the error middleware. */
const h = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = fn(req, res);
    if (out instanceof Promise) out.then((v) => v !== undefined && !res.headersSent && res.json(v)).catch(next);
    else if (out !== undefined && !res.headersSent) res.json(out);
  } catch (e) {
    next(e);
  }
};

export function submissionDetail(subId: number) {
  const sub = repo.submission(subId);
  if (!sub) throw new wf.WorkflowError('Submission not found', 404);
  const d = getDb();
  const versions = repo.versions(subId);
  const selected = versions.find((v) => v.id === sub.selectedVersionId) ?? versions[0];
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
    quotes: d.prepare('SELECT id, version_id AS versionId, quote_number AS quoteNumber, premium, total_cost AS totalCost, valid_until AS validUntil, status, created_by AS createdBy, created_at AS createdAt FROM quotes WHERE submission_id = ? ORDER BY id DESC').all(subId),
    documents: d.prepare('SELECT id, name, doc_type AS docType, mime_type AS mimeType, size, quote_id AS quoteId, uploaded_by AS uploadedBy, created_at AS createdAt FROM documents WHERE submission_id = ? ORDER BY id DESC').all(subId),
    notes: d.prepare('SELECT * FROM notes WHERE submission_id = ? ORDER BY id DESC').all(subId),
    activities: d.prepare('SELECT a.*, u.name AS assigned_name FROM activities a LEFT JOIN users u ON u.id = a.assigned_to WHERE submission_id = ? ORDER BY a.id DESC').all(subId),
    history: d.prepare('SELECT * FROM history WHERE submission_id = ? ORDER BY id DESC').all(subId),
  };
}

function submissionRows(where: string, params: (string | number)[], limit = 200) {
  return getDb()
    .prepare(`SELECT s.id, s.job_number AS jobNumber, s.product, s.status, s.effective_date AS effectiveDate, s.received_date AS receivedDate,
        s.priority, s.updated_at AS updatedAt, a.id AS accountId, a.name AS accountName, a.account_number AS accountNumber, a.state,
        p.name AS producerName, u.name AS underwriterName,
        (SELECT pricing_json IS NOT NULL FROM versions v WHERE v.id = s.selected_version_id) AS rated,
        (SELECT json_extract(pricing_json, '$.premium') FROM versions v WHERE v.id = s.selected_version_id) AS premium
      FROM submissions s JOIN accounts a ON a.id = s.account_id JOIN producers p ON p.id = s.producer_id LEFT JOIN users u ON u.id = s.underwriter_id
      WHERE ${where} ORDER BY s.updated_at DESC LIMIT ${limit}`)
    .all(...params)
    .map((r: any) => ({ ...r, statusLabel: STATUS_LABELS[r.status as keyof typeof STATUS_LABELS], productName: PRODUCTS[r.product as Product]?.name }));
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  const uploadDir = path.resolve(process.env.UPLOAD_DIR ?? path.join('data', 'uploads'));
  fs.mkdirSync(uploadDir, { recursive: true });
  const upload = multer({ dest: uploadDir, limits: { fileSize: 20 * 1024 * 1024 } });

  // Simple user context: the UI sends X-User-Id (user switcher). Default = first underwriter.
  app.use('/api', (req, res, next) => {
    const uid = Number(req.header('x-user-id')) || 0;
    const user = (uid && repo.user(uid)) || repo.users().find((u) => u.role === 'Underwriter') || repo.users()[0];
    if (!user) return res.status(500).json({ error: 'No users configured - run npm run seed' });
    req.user = user;
    next();
  });

  // ------------------------------------------------------------ reference & admin
  app.get('/api/reference', h(() => referenceData()));
  app.get('/api/me', h((req) => req.user));
  app.get('/api/users', h(() => repo.users()));
  app.get('/api/producers', h(() => repo.producers()));
  app.post('/api/producers', h((req) => {
    if (req.user.role !== 'Administrator') throw new wf.WorkflowError('Administrator only', 403);
    const p = req.body;
    if (!p.code || !p.name) throw new wf.WorkflowError('Code and name are required');
    const r = getDb().prepare('INSERT INTO producers(code, name, contact_name, email, phone, city, state, licensed_states, commission_pct, active) VALUES(?,?,?,?,?,?,?,?,?,1)')
      .run(p.code, p.name, p.contactName ?? '', p.email ?? '', p.phone ?? '', p.city ?? '', p.state ?? '', JSON.stringify(p.licensedStates ?? []), Number(p.commissionPct) || 15);
    return repo.producer(Number(r.lastInsertRowid));
  }));

  // ------------------------------------------------------------ desktop
  app.get('/api/desktop', h((req) => {
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
      recentQuotes: d.prepare(`SELECT q.id, q.quote_number AS quoteNumber, q.premium, q.valid_until AS validUntil, q.created_at AS createdAt, s.id AS submissionId,
        s.job_number AS jobNumber, s.product, a.name AS accountName FROM quotes q JOIN submissions s ON s.id = q.submission_id JOIN accounts a ON a.id = s.account_id
        WHERE q.status = 'Active' ORDER BY q.id DESC LIMIT 10`).all(),
    };
  }));

  // ------------------------------------------------------------ accounts
  app.get('/api/accounts', h((req) => {
    const q = String(req.query.q ?? '').trim();
    if (!q) return getDb().prepare('SELECT * FROM accounts ORDER BY id DESC LIMIT 100').all().map(mapAccount);
    const like = `%${q}%`;
    return getDb().prepare('SELECT * FROM accounts WHERE name LIKE ? OR dba LIKE ? OR account_number LIKE ? OR fein LIKE ? OR city LIKE ? ORDER BY name LIMIT 100')
      .all(like, like, like, like, like).map(mapAccount);
  }));
  /** Intake account match: fuzzy name / FEIN search used before creating a new account. */
  app.post('/api/accounts/match', h((req) => {
    const { name = '', fein = '' } = req.body as Partial<Account>;
    return repo.accounts()
      .map((a) => ({ account: a, score: fein && a.fein === fein ? 1 : nameSimilarity(a.name, name) }))
      .filter((m) => m.score >= 0.5)
      .sort((x, y) => y.score - x.score)
      .slice(0, 10);
  }));
  app.post('/api/accounts', h((req) => wf.createAccount(req.body, req.user)));
  app.get('/api/accounts/:id', h((req) => {
    const account = repo.account(id(req));
    if (!account) throw new wf.WorkflowError('Account not found', 404);
    return {
      account,
      submissions: submissionRows('s.account_id = ?', [account.id]),
      history: getDb().prepare('SELECT * FROM history WHERE account_id = ? ORDER BY id DESC LIMIT 50').all(account.id),
    };
  }));
  app.put('/api/accounts/:id', h((req) => wf.updateAccount(id(req), req.body, req.user)));

  // ------------------------------------------------------------ submissions
  app.get('/api/submissions', h((req) => {
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
  }));

  /** New Submission wizard: one submission per selected product (PolicyCenter "New Submissions" screen). */
  app.post('/api/submissions', h((req) => {
    const b = req.body as { accountId?: number; newAccount?: Partial<Account>; products: Product[] } & Omit<wf.NewSubmissionInput, 'product' | 'accountId'>;
    if (!b.products?.length) throw new wf.WorkflowError('Select at least one product');
    const accountId = b.accountId ?? (b.newAccount ? wf.createAccount(b.newAccount, req.user).id : undefined);
    if (!accountId) throw new wf.WorkflowError('An account is required');
    const created = b.products.map((product) => wf.createSubmission({ ...b, accountId, product }, req.user));
    return { accountId, submissions: created };
  }));

  /** Broker portal / ACORD-style intake API. Matches the account by FEIN or exact name, otherwise creates it. */
  app.post('/api/intake', h((req) => {
    const b = req.body as { account: Partial<Account>; producerCode: string; products: Product[]; effectiveDate: string; source?: string; description?: string; priority?: 'Low' | 'Normal' | 'High' | 'Rush' };
    const producer = repo.producers().find((p) => p.code === b.producerCode);
    if (!producer) throw new wf.WorkflowError(`Unknown producer code ${b.producerCode}`);
    if (!b.account?.name) throw new wf.WorkflowError('account.name is required');
    const existing = repo.accounts().find((a) => (b.account.fein && a.fein === b.account.fein) || a.name.toLowerCase() === b.account.name!.toLowerCase());
    const account = existing ?? wf.createAccount(b.account, req.user);
    const submissions = (b.products ?? []).map((product) =>
      wf.createSubmission({ accountId: account.id, producerId: producer.id, product, effectiveDate: b.effectiveDate, source: b.source ?? 'API', description: b.description, priority: b.priority }, req.user));
    return { account, matchedExistingAccount: !!existing, submissions: submissions.map((s) => ({ id: s.id, jobNumber: s.jobNumber, status: s.status, clearance: s.clearance?.outcome })) };
  }));

  app.get('/api/submissions/:id', h((req) => submissionDetail(id(req))));
  app.put('/api/submissions/:id', h((req) => { wf.updateSubmissionInfo(id(req), req.body, req.user); return submissionDetail(id(req)); }));
  app.post('/api/submissions/:id/clearance', h((req) => { wf.clearSubmission(id(req), req.user); return submissionDetail(id(req)); }));
  app.post('/api/submissions/:id/clearance/override', h((req) => { wf.overrideClearance(id(req), req.body.reason, req.user); return submissionDetail(id(req)); }));
  app.put('/api/submissions/:id/versions/:vid/risk', h((req) => { wf.updateRisk(id(req), id(req, 'vid'), req.body, req.user); return submissionDetail(id(req)); }));
  app.put('/api/submissions/:id/versions/:vid', h((req) => { wf.renameVersion(id(req), id(req, 'vid'), String(req.body.name ?? '')); return submissionDetail(id(req)); }));
  app.post('/api/submissions/:id/versions/:vid/copy', h((req) => { wf.copyVersion(id(req), id(req, 'vid'), req.user); return submissionDetail(id(req)); }));
  app.post('/api/submissions/:id/versions/:vid/select', h((req) => { wf.selectVersion(id(req), id(req, 'vid'), req.user); return submissionDetail(id(req)); }));
  app.post('/api/submissions/:id/scan', h((req) => { wf.runScan(id(req), req.user); return submissionDetail(id(req)); }));
  app.post('/api/submissions/:id/evaluate', h((req) => {
    const sub = repo.submission(id(req));
    if (!sub?.selectedVersionId) throw new wf.WorkflowError('Submission not found', 404);
    wf.syncIssues(sub.id, sub.selectedVersionId);
    return submissionDetail(sub.id);
  }));
  app.post('/api/submissions/:id/rate', h((req) => { wf.rateSubmission(id(req), req.user, req.body?.versionId); return submissionDetail(id(req)); }));
  app.post('/api/submissions/:id/quote', h((req) => { wf.issueQuote(id(req), req.user); return submissionDetail(id(req)); }));
  app.post('/api/submissions/:id/edit-quote', h((req) => { wf.editQuote(id(req), req.user); return submissionDetail(id(req)); }));
  app.post('/api/submissions/:id/decline', h((req) => { wf.declineSubmission(id(req), req.body.reason, req.user); return submissionDetail(id(req)); }));
  app.post('/api/submissions/:id/withdraw', h((req) => { wf.withdrawSubmission(id(req), req.body.reason, req.user); return submissionDetail(id(req)); }));
  app.post('/api/submissions/:id/reopen', h((req) => { wf.reopenSubmission(id(req), req.user); return submissionDetail(id(req)); }));

  app.post('/api/issues/:id/decision', h((req) => wf.decideIssue(id(req), req.body.decision, req.body.note ?? '', req.user)));
  app.post('/api/issues/:id/refer', h((req) => wf.referIssue(id(req), req.body.note ?? '', req.user)));

  // ------------------------------------------------------------ notes & activities
  app.post('/api/submissions/:id/notes', h((req) => {
    const sub = repo.submission(id(req));
    if (!sub) throw new wf.WorkflowError('Submission not found', 404);
    if (!req.body.body?.trim()) throw new wf.WorkflowError('Note text is required');
    getDb().prepare('INSERT INTO notes(submission_id, account_id, topic, subject, body, author, created_at) VALUES(?,?,?,?,?,?,?)')
      .run(sub.id, sub.accountId, req.body.topic ?? 'General', req.body.subject ?? '', req.body.body, req.user.name, now());
    return submissionDetail(sub.id);
  }));
  app.post('/api/submissions/:id/activities', h((req) => {
    const sub = repo.submission(id(req));
    if (!sub) throw new wf.WorkflowError('Submission not found', 404);
    if (!req.body.subject?.trim()) throw new wf.WorkflowError('Subject is required');
    repo.activity({ submissionId: sub.id, subject: req.body.subject, description: req.body.description, assignedTo: Number(req.body.assignedTo) || req.user.id, priority: req.body.priority, dueDate: req.body.dueDate });
    return submissionDetail(sub.id);
  }));
  app.post('/api/activities/:id/complete', h((req) => {
    getDb().prepare("UPDATE activities SET status='Completed', completed_at=? WHERE id=?").run(now(), id(req));
    return { ok: true };
  }));

  // ------------------------------------------------------------ documents
  app.post('/api/submissions/:id/documents', upload.single('file'), h((req) => {
    const sub = repo.submission(id(req));
    if (!sub) throw new wf.WorkflowError('Submission not found', 404);
    if (!req.file) throw new wf.WorkflowError('No file uploaded');
    getDb().prepare('INSERT INTO documents(submission_id, name, doc_type, mime_type, size, storage_path, uploaded_by, created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(sub.id, req.file.originalname, String(req.body.docType ?? 'Broker Submission'), req.file.mimetype, req.file.size, req.file.filename, req.user.name, now());
    repo.history(sub.id, sub.accountId, 'Document uploaded', req.file.originalname, req.user.name);
    return submissionDetail(sub.id);
  }));
  app.get('/api/documents/:id/download', h(async (req, res) => {
    const doc = getDb().prepare('SELECT * FROM documents WHERE id = ?').get(id(req)) as any;
    if (!doc) throw new wf.WorkflowError('Document not found', 404);
    if (doc.quote_id) return res.redirect(`/api/quotes/${doc.quote_id}/pdf`);
    const file = path.join(uploadDir, path.basename(doc.storage_path));
    if (!fs.existsSync(file)) throw new wf.WorkflowError('File missing from storage', 404);
    res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${String(doc.name).replace(/"/g, '')}"`);
    fs.createReadStream(file).pipe(res);
  }));
  app.get('/api/quotes/:id/pdf', h(async (req, res) => {
    const q = getDb().prepare('SELECT * FROM quotes WHERE id = ?').get(id(req)) as any;
    if (!q) throw new wf.WorkflowError('Quote not found', 404);
    const pdf = await renderQuotePdf(JSON.parse(q.snapshot_json) as QuoteSnapshot);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="Quote-${q.quote_number}.pdf"`);
    res.end(pdf);
  }));

  // ------------------------------------------------------------ static web app
  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof wf.WorkflowError) return res.status(err.status).json({ error: err.message, details: err.details });
    console.error(err);
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  });
  return app;
}

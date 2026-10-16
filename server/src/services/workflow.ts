// Submission workflow orchestration: intake -> clearance -> risk entry -> CRP scan
// -> UW rules -> pricing -> quote. Bind is intentionally out of scope.

import { getDb, mapIssue, nextSequence, now, repo, transaction } from '../db.js';
import { PRODUCTS, defaultRisk, formsFor } from '../products/index.js';
import type { Account, ClearanceResult, Product, RiskData, Submission, SubmissionStatus, User, UWIssue, Version } from '../types.js';
import { runClearance } from './clearance.js';
import { rate } from './rating/index.js';
import { runCrpScan } from './scan/crp.js';
import { evaluateRules, standardSubjectivities } from './uwRules.js';
import { validateRisk, type ValidationMessage } from './validation.js';
import { syncSubjectivities } from './policy.js';

export class WorkflowError extends Error {
  constructor(message: string, public status = 400, public details?: unknown) {
    super(message);
  }
}

const EDITABLE: SubmissionStatus[] = ['DRAFT', 'RATED'];

function requireSubmission(id: number): Submission {
  const s = repo.submission(id);
  if (!s) throw new WorkflowError('Submission not found', 404);
  return s;
}

function requireAccount(id: number): Account {
  const a = repo.account(id);
  if (!a) throw new WorkflowError('Account not found', 404);
  return a;
}

function requireVersion(sub: Submission, versionId?: number | null): Version {
  const id = versionId ?? sub.selectedVersionId;
  const v = id ? repo.version(id) : undefined;
  if (!v || v.submissionId !== sub.id) throw new WorkflowError('Version not found', 404);
  return v;
}

function assertEditable(sub: Submission) {
  if (!EDITABLE.includes(sub.status)) {
    throw new WorkflowError(`Submission is ${sub.status.replace('_', ' ').toLowerCase()} and cannot be edited${sub.status === 'QUOTED' ? ' - use Edit Quote first' : ''}.`, 409);
  }
}

function addYear(date: string): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ Accounts

export function createAccount(data: Partial<Account>, user: User): Account {
  if (!data.name?.trim()) throw new WorkflowError('Account name is required');
  const accountNumber = `A${nextSequence('account', 100000)}`;
  const r = getDb()
    .prepare(`INSERT INTO accounts(account_number, name, dba, fein, entity_type, naics, industry, address1, city, state, zip, website,
      years_in_business, annual_revenue, employee_count, contact_name, contact_email, contact_phone, status, created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(accountNumber, data.name.trim(), data.dba ?? '', data.fein ?? '', data.entityType ?? '', data.naics ?? '', data.industry ?? '',
      data.address1 ?? '', data.city ?? '', data.state ?? '', data.zip ?? '', data.website ?? '', Number(data.yearsInBusiness) || 0,
      Number(data.annualRevenue) || 0, Number(data.employeeCount) || 0, data.contactName ?? '', data.contactEmail ?? '', data.contactPhone ?? '',
      'Active', now());
  const id = Number(r.lastInsertRowid);
  repo.history(null, id, 'Account created', `${accountNumber} ${data.name}`, user.name);
  return repo.account(id)!;
}

export function updateAccount(id: number, data: Partial<Account>, user: User): Account {
  const a = requireAccount(id);
  const m = { ...a, ...data };
  getDb()
    .prepare(`UPDATE accounts SET name=?, dba=?, fein=?, entity_type=?, naics=?, industry=?, address1=?, city=?, state=?, zip=?, website=?,
      years_in_business=?, annual_revenue=?, employee_count=?, contact_name=?, contact_email=?, contact_phone=? WHERE id=?`)
    .run(m.name, m.dba, m.fein, m.entityType, m.naics, m.industry, m.address1, m.city, m.state, m.zip, m.website,
      Number(m.yearsInBusiness) || 0, Number(m.annualRevenue) || 0, Number(m.employeeCount) || 0, m.contactName, m.contactEmail, m.contactPhone, id);
  repo.history(null, id, 'Account updated', '', user.name);
  return repo.account(id)!;
}

// ------------------------------------------------------------------ Intake

export interface NewSubmissionInput {
  accountId: number;
  producerId: number;
  product: Product;
  effectiveDate: string;
  receivedDate?: string;
  source?: string;
  priority?: Submission['priority'];
  description?: string;
  underwriterId?: number | null;
}

/** Pick the underwriter with the lightest open workload. */
export function autoAssignUnderwriter(): number | null {
  const row = getDb()
    .prepare(`SELECT u.id, (SELECT COUNT(*) FROM submissions s WHERE s.underwriter_id = u.id AND s.status IN ('INTAKE','CLEARANCE_REFERRAL','DRAFT','RATED')) AS load
      FROM users u WHERE u.role IN ('Underwriter','Senior Underwriter') ORDER BY load ASC, u.id ASC LIMIT 1`)
    .get() as { id: number } | undefined;
  return row?.id ?? null;
}

export function createSubmission(input: NewSubmissionInput, user: User): Submission {
  const account = requireAccount(input.accountId);
  if (!repo.producer(input.producerId)) throw new WorkflowError('Producer not found');
  if (!PRODUCTS[input.product]) throw new WorkflowError('Unknown product');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate ?? '')) throw new WorkflowError('Effective date is required (YYYY-MM-DD)');

  const id = transaction(() => {
    const jobNumber = `${PRODUCTS[input.product].abbreviation}-${nextSequence('job', 20000)}`;
    const ts = now();
    const r = getDb()
      .prepare(`INSERT INTO submissions(job_number, account_id, producer_id, product, status, underwriter_id, effective_date, expiration_date,
        received_date, source, priority, description, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(jobNumber, account.id, input.producerId, input.product, 'INTAKE', input.underwriterId ?? autoAssignUnderwriter(), input.effectiveDate,
        addYear(input.effectiveDate), input.receivedDate || ts.slice(0, 10), input.source ?? 'Broker Email', input.priority ?? 'Normal',
        input.description ?? '', ts, ts);
    const subId = Number(r.lastInsertRowid);
    const v = getDb()
      .prepare('INSERT INTO versions(submission_id, version_no, name, risk_json, status, created_at) VALUES(?,?,?,?,?,?)')
      .run(subId, 1, 'Version 1', JSON.stringify(defaultRisk(input.product, account)), 'Draft', ts);
    repo.updateSubmission(subId, { selected_version_id: Number(v.lastInsertRowid) });
    repo.history(subId, account.id, 'Submission created', `${jobNumber} ${PRODUCTS[input.product].name} via ${input.source ?? 'Broker Email'}`, user.name);
    return subId;
  });
  // Clearance runs automatically at intake.
  return clearSubmission(id, user);
}

// ------------------------------------------------------------------ Clearance

export function clearSubmission(id: number, user: User): Submission {
  const sub = requireSubmission(id);
  if (sub.jobType !== 'Submission') throw new WorkflowError('Clearance applies to new business submissions only.', 409);
  if (!['INTAKE', 'CLEARANCE_REFERRAL', 'DRAFT'].includes(sub.status)) throw new WorkflowError('Clearance can only be run before rating.', 409);
  const result = runClearance(sub);
  return applyClearance(sub, result, user);
}

function applyClearance(sub: Submission, result: ClearanceResult, user: User): Submission {
  let status: SubmissionStatus;
  let declineReason: string | null = null;
  if (result.outcome === 'PASS') status = 'DRAFT';
  else if (result.outcome === 'REFER') status = 'CLEARANCE_REFERRAL';
  else {
    status = 'DECLINED';
    declineReason = result.checks.filter((c) => c.outcome === 'DECLINE').map((c) => `${c.name}: ${c.details?.join('; ') || c.message}`).join(' | ');
  }
  repo.updateSubmission(sub.id, { clearance_json: result, status, decline_reason: declineReason });
  repo.history(sub.id, sub.accountId, 'Clearance run', `Outcome ${result.outcome}`, user.name);
  if (status === 'CLEARANCE_REFERRAL') {
    repo.activity({
      submissionId: sub.id, subject: 'Review clearance referral', priority: 'High', assignedTo: sub.underwriterId,
      description: result.checks.filter((c) => c.outcome !== 'PASS').map((c) => `${c.name}: ${c.message}`).join('\n'),
      dueDate: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
    });
  }
  return repo.submission(sub.id)!;
}

export function overrideClearance(id: number, reason: string, user: User): Submission {
  const sub = requireSubmission(id);
  if (!sub.clearance) throw new WorkflowError('Clearance has not been run.');
  if (!['CLEARANCE_REFERRAL', 'DECLINED'].includes(sub.status)) throw new WorkflowError('Nothing to override.', 409);
  if (!reason?.trim()) throw new WorkflowError('An override reason is required.');
  const needed = sub.clearance.outcome === 'DECLINE' ? 3 : 2;
  if (user.authorityLevel < needed) throw new WorkflowError(`Clearance override requires authority level ${needed}.`, 403);
  const clearance: ClearanceResult = { ...sub.clearance, override: { by: user.name, reason: reason.trim(), at: now() } };
  repo.updateSubmission(id, { clearance_json: clearance, status: 'DRAFT', decline_reason: null });
  closeActivities(id, 'Review clearance referral');
  repo.history(id, sub.accountId, 'Clearance overridden', reason, user.name);
  return repo.submission(id)!;
}

function closeActivities(subId: number, subject: string) {
  getDb().prepare("UPDATE activities SET status='Completed', completed_at=? WHERE submission_id=? AND subject=? AND status='Open'").run(now(), subId, subject);
}

// ------------------------------------------------------------------ Risk entry

export function updateSubmissionInfo(id: number, data: Partial<Submission>, user: User): Submission {
  const sub = requireSubmission(id);
  const fields: Record<string, unknown> = {};
  if (data.paymentPlan !== undefined || data.billingMethod !== undefined) {
    if (!['DRAFT', 'RATED', 'QUOTED'].includes(sub.status)) throw new WorkflowError('Payment details can only be changed before bind.', 409);
    if (data.paymentPlan) fields.payment_plan = data.paymentPlan;
    if (data.billingMethod) fields.billing_method = data.billingMethod;
  }
  if (['QUOTED', 'BOUND', 'DECLINED', 'WITHDRAWN', 'NON_RENEWED'].includes(sub.status)) {
    if (Object.keys(fields).length && Object.keys(data).every((k) => k === 'paymentPlan' || k === 'billingMethod')) {
      repo.updateSubmission(id, fields);
      repo.history(id, sub.accountId, 'Payment details updated', `${data.paymentPlan ?? sub.paymentPlan}, ${data.billingMethod ?? sub.billingMethod}`, user.name);
      return repo.submission(id)!;
    }
    throw new WorkflowError('This transaction cannot be edited in its current status.', 409);
  }
  if (sub.jobType !== 'Submission' && data.effectiveDate && data.effectiveDate !== sub.effectiveDate) {
    throw new WorkflowError('The effective date of a policy transaction is fixed. Withdraw it and start a new one.', 409);
  }
  if (data.effectiveDate && data.effectiveDate !== sub.effectiveDate) {
    fields.effective_date = data.effectiveDate;
    fields.expiration_date = addYear(data.effectiveDate);
  }
  if (data.producerId) fields.producer_id = data.producerId;
  if (data.underwriterId !== undefined) fields.underwriter_id = data.underwriterId;
  if (data.priority) fields.priority = data.priority;
  if (data.description !== undefined) fields.description = data.description;
  if (data.source) fields.source = data.source;
  if (sub.status === 'RATED' && (fields.effective_date || fields.producer_id)) {
    invalidatePricing(sub);
    fields.status = 'DRAFT';
  }
  repo.updateSubmission(id, fields);
  repo.history(id, sub.accountId, 'Policy info updated', Object.keys(fields).join(', '), user.name);
  return repo.submission(id)!;
}

function invalidatePricing(sub: Submission) {
  getDb().prepare("UPDATE versions SET pricing_json = NULL, status = 'Draft' WHERE submission_id = ?").run(sub.id);
}

export function updateRisk(subId: number, versionId: number, risk: RiskData, user: User): Version {
  const sub = requireSubmission(subId);
  assertEditable(sub);
  const v = requireVersion(sub, versionId);
  if (risk.product !== sub.product) throw new WorkflowError('Risk product does not match submission.');
  getDb().prepare("UPDATE versions SET risk_json = ?, pricing_json = NULL, status = 'Draft' WHERE id = ?").run(JSON.stringify(risk), v.id);
  if (sub.status === 'RATED' && sub.selectedVersionId === v.id) repo.updateSubmission(subId, { status: 'DRAFT' });
  repo.history(subId, sub.accountId, 'Risk details updated', v.name, user.name);
  return repo.version(v.id)!;
}

export function copyVersion(subId: number, versionId: number, user: User): Version {
  const sub = requireSubmission(subId);
  assertEditable(sub);
  const v = requireVersion(sub, versionId);
  const max = (getDb().prepare('SELECT MAX(version_no) AS m FROM versions WHERE submission_id = ?').get(subId) as { m: number }).m;
  if (max >= 5) throw new WorkflowError('A submission can have at most 5 versions.');
  const r = getDb()
    .prepare('INSERT INTO versions(submission_id, version_no, name, risk_json, status, created_at) VALUES(?,?,?,?,?,?)')
    .run(subId, max + 1, `Version ${max + 1}`, JSON.stringify(v.risk), 'Draft', now());
  repo.history(subId, sub.accountId, 'Version created', `Copied from ${v.name}`, user.name);
  return repo.version(Number(r.lastInsertRowid))!;
}

export function selectVersion(subId: number, versionId: number, user: User): Submission {
  const sub = requireSubmission(subId);
  assertEditable(sub);
  const v = requireVersion(sub, versionId);
  repo.updateSubmission(subId, { selected_version_id: v.id, status: v.status === 'Rated' ? 'RATED' : 'DRAFT' });
  repo.history(subId, sub.accountId, 'Version selected', v.name, user.name);
  return repo.submission(subId)!;
}

export function renameVersion(subId: number, versionId: number, name: string): Version {
  const sub = requireSubmission(subId);
  const v = requireVersion(sub, versionId);
  getDb().prepare('UPDATE versions SET name = ? WHERE id = ?').run(name.trim() || v.name, v.id);
  return repo.version(v.id)!;
}

// ------------------------------------------------------------------ Risk analysis

export function runScan(subId: number, user: User): Submission {
  const sub = requireSubmission(subId);
  assertEditable(sub);
  const account = requireAccount(sub.accountId);
  const v = requireVersion(sub);
  const scan = runCrpScan(account, v.risk);
  repo.updateSubmission(subId, { scan_json: scan });
  if (sub.product === 'CYBER') {
    // Posture score is a rating input: re-rating is required.
    invalidatePricing(sub);
    repo.updateSubmission(subId, { status: 'DRAFT' });
  }
  repo.history(subId, sub.accountId, 'CRP scan completed', `Score ${scan.compositeScore} (${scan.grade}) - ${scan.sections.flatMap((s) => s.findings).length} findings`, user.name);
  syncIssues(subId, v.id);
  return repo.submission(subId)!;
}

/** Re-evaluate UW rules for a version, preserving decisions whose value has not changed. */
export function syncIssues(subId: number, versionId: number): UWIssue[] {
  const sub = requireSubmission(subId);
  const account = requireAccount(sub.accountId);
  const v = requireVersion(sub, versionId);
  const templates = evaluateRules({ submission: sub, account, risk: v.risk, scan: sub.scan, pricing: v.pricing, clearance: sub.clearance });
  const d = getDb();
  const existing = repo.issues(subId, versionId);
  const keep = new Set<number>();
  for (const t of templates) {
    const prev = existing.find((e) => e.code === t.code);
    if (prev && prev.value === t.value) {
      keep.add(prev.id);
      d.prepare('UPDATE uw_issues SET short_description=?, long_description=?, blocking_point=?, required_authority=?, subjectivity=? WHERE id=?')
        .run(t.shortDescription, t.longDescription, t.blockingPoint, t.requiredAuthority, t.subjectivity ?? null, prev.id);
      continue;
    }
    if (prev) {
      // Value changed: prior approval no longer applies.
      keep.add(prev.id);
      d.prepare("UPDATE uw_issues SET short_description=?, long_description=?, blocking_point=?, required_authority=?, value=?, subjectivity=?, status='Open', decided_by=NULL, decided_at=NULL, decision_note=NULL WHERE id=?")
        .run(t.shortDescription, t.longDescription, t.blockingPoint, t.requiredAuthority, t.value, t.subjectivity ?? null, prev.id);
      continue;
    }
    const status = t.blockingPoint === 'Informational' ? 'Approved' : 'Open';
    const r = d.prepare(`INSERT INTO uw_issues(submission_id, version_id, code, short_description, long_description, blocking_point, required_authority, value, status, subjectivity, decided_by, decided_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(subId, versionId, t.code, t.shortDescription, t.longDescription, t.blockingPoint, t.requiredAuthority, t.value, status, t.subjectivity ?? null,
        status === 'Approved' ? 'System' : null, status === 'Approved' ? now() : null);
    keep.add(Number(r.lastInsertRowid));
  }
  for (const e of existing) if (!keep.has(e.id)) d.prepare('DELETE FROM uw_issues WHERE id = ?').run(e.id);
  return repo.issues(subId, versionId);
}

export function decideIssue(issueId: number, decision: 'Approve' | 'Reject' | 'Reopen', note: string, user: User): UWIssue {
  const row = getDb().prepare('SELECT * FROM uw_issues WHERE id = ?').get(issueId);
  if (!row) throw new WorkflowError('Issue not found', 404);
  const issue = mapIssue(row);
  const sub = requireSubmission(issue.submissionId);
  if (!EDITABLE.includes(sub.status)) throw new WorkflowError('Issues can only be decided while the submission is in Draft or Rated.', 409);
  if (user.authorityLevel < issue.requiredAuthority) {
    throw new WorkflowError(`${user.name} (authority ${user.authorityLevel}) cannot decide an issue requiring authority ${issue.requiredAuthority}. Refer to a higher authority.`, 403);
  }
  if (decision === 'Reopen') {
    getDb().prepare("UPDATE uw_issues SET status='Open', decided_by=NULL, decided_at=NULL, decision_note=NULL WHERE id=?").run(issueId);
  } else {
    getDb().prepare('UPDATE uw_issues SET status=?, decided_by=?, decided_at=?, decision_note=? WHERE id=?')
      .run(decision === 'Approve' ? 'Approved' : 'Rejected', user.name, now(), note ?? '', issueId);
  }
  repo.history(sub.id, sub.accountId, `UW issue ${decision.toLowerCase()}d`, `${issue.shortDescription}${note ? ` - ${note}` : ''}`, user.name);
  return mapIssue(getDb().prepare('SELECT * FROM uw_issues WHERE id = ?').get(issueId)!);
}

export function referIssue(issueId: number, note: string, user: User) {
  const row = getDb().prepare('SELECT * FROM uw_issues WHERE id = ?').get(issueId);
  if (!row) throw new WorkflowError('Issue not found', 404);
  const issue = mapIssue(row);
  const approver = getDb().prepare('SELECT id, name FROM users WHERE authority_level >= ? ORDER BY authority_level, id LIMIT 1').get(issue.requiredAuthority) as { id: number; name: string } | undefined;
  if (!approver) throw new WorkflowError('No user holds the required authority.');
  repo.activity({ submissionId: issue.submissionId, subject: `Approve UW issue: ${issue.shortDescription}`, description: note || issue.longDescription, assignedTo: approver.id, priority: 'High', dueDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) });
  repo.history(issue.submissionId, null, 'UW issue referred', `${issue.shortDescription} -> ${approver.name}`, user.name);
  return { referredTo: approver.name };
}

// ------------------------------------------------------------------ Pricing

export function rateSubmission(subId: number, user: User, versionId?: number): { version: Version; validation: ValidationMessage[] } {
  const sub = requireSubmission(subId);
  assertEditable(sub);
  const account = requireAccount(sub.accountId);
  const v = requireVersion(sub, versionId);
  const validation = validateRisk(v.risk);
  if (validation.some((m) => m.level === 'error')) throw new WorkflowError('Validation errors must be resolved before rating.', 422, validation);
  const pricing = rate(v.risk, account, sub.scan, sub.effectiveDate);
  getDb().prepare("UPDATE versions SET pricing_json = ?, status = 'Rated' WHERE id = ?").run(JSON.stringify(pricing), v.id);
  if (v.id === sub.selectedVersionId) repo.updateSubmission(subId, { status: 'RATED' });
  syncIssues(subId, v.id);
  repo.history(subId, sub.accountId, 'Rated', `${v.name}: premium $${pricing.premium.toLocaleString()}`, user.name);
  return { version: repo.version(v.id)!, validation };
}

// ------------------------------------------------------------------ Quote

export function quoteBlockers(sub: Submission, v: Version): string[] {
  const blockers: string[] = [];
  if (!v.pricing) blockers.push('Version has not been rated.');
  for (const i of repo.issues(sub.id, v.id)) {
    if (i.blockingPoint !== 'Quote') continue;
    if (i.status === 'Open') blockers.push(`Open UW issue blocks quote: ${i.shortDescription} (requires authority ${i.requiredAuthority})`);
    if (i.status === 'Rejected') blockers.push(`Rejected UW issue: ${i.shortDescription}`);
  }
  return blockers;
}

export function issueQuote(subId: number, user: User) {
  const sub = requireSubmission(subId);
  if (sub.status !== 'RATED') throw new WorkflowError('Submission must be rated before quoting.', 409);
  const v = requireVersion(sub);
  syncIssues(subId, v.id);
  const blockers = quoteBlockers(sub, v);
  if (blockers.length) throw new WorkflowError('Quote is blocked.', 409, blockers);
  const account = requireAccount(sub.accountId);
  const producer = repo.producer(sub.producerId)!;
  const underwriter = sub.underwriterId ? repo.user(sub.underwriterId) : undefined;
  const subjectivities = subjectivitiesFor(sub, v.id);
  // Quotes are valid for 30 days, or until the effective date if that is sooner.
  const in30 = Date.now() + 30 * 86_400_000;
  const eff = new Date(sub.effectiveDate + 'T00:00:00Z').getTime();
  const validUntil = new Date(eff > Date.now() ? Math.min(in30, eff) : in30).toISOString().slice(0, 10);
  const quoteNumber = `Q${PRODUCTS[sub.product].abbreviation}${nextSequence('quote', 500000)}`;
  const snapshot = {
    quoteNumber, issuedAt: now(), validUntil,
    product: sub.product, productName: PRODUCTS[sub.product].name,
    jobNumber: sub.jobNumber, effectiveDate: sub.effectiveDate, expirationDate: sub.expirationDate,
    account, producer, underwriter: underwriter ? { name: underwriter.name, email: underwriter.email } : null,
    versionName: v.name, risk: v.risk, pricing: v.pricing!,
    scan: sub.scan ? { compositeScore: sub.scan.compositeScore, grade: sub.scan.grade, provider: sub.scan.provider } : null,
    forms: applicableForms(v.risk), subjectivities,
  };
  const id = transaction(() => {
    getDb().prepare("UPDATE quotes SET status='Superseded' WHERE submission_id = ? AND status='Active'").run(subId);
    const r = getDb()
      .prepare('INSERT INTO quotes(submission_id, version_id, quote_number, premium, total_cost, valid_until, snapshot_json, created_by, created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(subId, v.id, quoteNumber, v.pricing!.premium, v.pricing!.totalCost, validUntil, JSON.stringify(snapshot), user.name, now());
    const quoteId = Number(r.lastInsertRowid);
    getDb().prepare('INSERT INTO documents(submission_id, name, doc_type, mime_type, quote_id, uploaded_by, created_at) VALUES(?,?,?,?,?,?,?)')
      .run(subId, `Quote Proposal ${quoteNumber}.pdf`, 'Quote Proposal', 'application/pdf', quoteId, 'System', now());
    getDb().prepare("UPDATE versions SET status='Quoted' WHERE id = ?").run(v.id);
    repo.updateSubmission(subId, { status: 'QUOTED' });
    if (sub.jobType === 'Submission' || sub.jobType === 'Renewal') syncSubjectivities(sub, v.id);
    repo.history(subId, sub.accountId, 'Quote issued', `${quoteNumber} - premium $${v.pricing!.premium.toLocaleString()}, valid until ${validUntil}`, user.name);
    return quoteId;
  });
  return getDb().prepare('SELECT * FROM quotes WHERE id = ?').get(id);
}

/** Standard product subjectivities plus those raised by (non-rejected) UW issues. */
export function subjectivitiesFor(sub: Submission, versionId: number): string[] {
  const fromIssues = repo.issues(sub.id, versionId).filter((i) => i.subjectivity && i.status !== 'Rejected').map((i) => i.subjectivity!);
  return [...new Set([...standardSubjectivities(sub.product), ...fromIssues])];
}

export function applicableForms(risk: RiskData) {
  const forms = formsFor(risk.product);
  if (risk.product === 'CYBER') {
    const c = risk.coverages;
    return forms.filter((f) =>
      (f.number !== 'CY 05 02 01 25' || c.ransomwareSublimitPct < 100 || c.ransomwareCoinsurancePct > 0) &&
      (f.number !== 'CY 05 10 01 25' || c.socialEngineeringLimit > 0) &&
      (f.number !== 'CY 05 20 01 25' || c.dependentBI) &&
      (f.number !== 'CY 05 30 01 25' || c.mediaLiability));
  }
  if (risk.product === 'PROPERTY') {
    const c = risk.coverages;
    const col = { Basic: 'CP 10 10 10 12', Broad: 'CP 10 20 10 12', Special: 'CP 10 30 09 17' }[c.causeOfLoss];
    return forms.filter((f) =>
      (!f.number.startsWith('CP 10 ') || f.number === col || (f.number === 'CP 10 40 10 12' && c.earthquake)) &&
      (f.number !== 'CP 03 21 10 12' || c.windHailDeductiblePct > 0) &&
      (f.number !== 'EB 00 20 01 25' || c.equipmentBreakdown) &&
      (f.number !== 'CP 00 30 10 12' || risk.buildings.some((b) => b.biValue > 0)));
  }
  const c = risk.coverages;
  return forms.filter((f) =>
    (f.number !== 'CG 03 00 01 96' || c.deductible > 0) &&
    (f.number !== 'CG 20 10 12 19' || c.blanketAdditionalInsured) &&
    (f.number !== 'CG 24 04 12 19' || c.waiverOfSubrogation) &&
    (f.number !== 'CG 21 70 01 15' || c.terrorism));
}

export function editQuote(subId: number, user: User): Submission {
  const sub = requireSubmission(subId);
  if (sub.status !== 'QUOTED') throw new WorkflowError('Only quoted submissions can be edited.', 409);
  if (sub.jobType === 'Cancellation' || sub.jobType === 'Reinstatement') throw new WorkflowError('Withdraw this transaction and start a new one to change its terms.', 409);
  getDb().prepare("UPDATE quotes SET status='Superseded' WHERE submission_id = ? AND status='Active'").run(subId);
  getDb().prepare("UPDATE versions SET status='Rated' WHERE submission_id = ? AND status='Quoted'").run(subId);
  repo.updateSubmission(subId, { status: 'RATED' });
  repo.history(subId, sub.accountId, 'Quote reopened for edit', 'Prior quote superseded', user.name);
  return repo.submission(subId)!;
}

// ------------------------------------------------------------------ Close options

export function declineSubmission(subId: number, reason: string, user: User): Submission {
  const sub = requireSubmission(subId);
  if (['DECLINED', 'WITHDRAWN', 'BOUND', 'NON_RENEWED'].includes(sub.status)) throw new WorkflowError('This transaction is already closed.', 409);
  if (sub.jobType !== 'Submission') throw new WorkflowError('Only new business submissions can be declined. Withdraw the transaction, or non-renew a renewal.', 409);
  if (!reason?.trim()) throw new WorkflowError('A decline reason is required.');
  if (user.authorityLevel < 1) throw new WorkflowError('Only underwriters can decline submissions.', 403);
  getDb().prepare("UPDATE quotes SET status='Superseded' WHERE submission_id = ? AND status='Active'").run(subId);
  repo.updateSubmission(subId, { status: 'DECLINED', decline_reason: reason.trim() });
  getDb().prepare("UPDATE activities SET status='Cancelled' WHERE submission_id=? AND status='Open'").run(subId);
  repo.history(subId, sub.accountId, 'Declined', reason, user.name);
  return repo.submission(subId)!;
}

export function withdrawSubmission(subId: number, reason: string, user: User): Submission {
  const sub = requireSubmission(subId);
  if (['DECLINED', 'WITHDRAWN', 'BOUND', 'NON_RENEWED'].includes(sub.status)) throw new WorkflowError('This transaction is already closed.', 409);
  getDb().prepare("UPDATE quotes SET status='Superseded' WHERE submission_id = ? AND status='Active'").run(subId);
  repo.updateSubmission(subId, { status: 'WITHDRAWN', decline_reason: reason?.trim() || (sub.jobType === 'Submission' ? 'Withdrawn by producer' : 'Transaction withdrawn') });
  getDb().prepare("UPDATE activities SET status='Cancelled' WHERE submission_id=? AND status='Open'").run(subId);
  repo.history(subId, sub.accountId, 'Withdrawn', reason ?? '', user.name);
  return repo.submission(subId)!;
}

export function reopenSubmission(subId: number, user: User): Submission {
  const sub = requireSubmission(subId);
  if (!['DECLINED', 'WITHDRAWN'].includes(sub.status) || sub.jobType !== 'Submission') throw new WorkflowError('Only declined or withdrawn submissions can be reopened.', 409);
  if (user.authorityLevel < 2) throw new WorkflowError('Reopening requires authority level 2.', 403);
  invalidatePricing(sub);
  repo.updateSubmission(subId, { status: 'DRAFT', decline_reason: null });
  repo.history(subId, sub.accountId, 'Reopened', '', user.name);
  return repo.submission(subId)!;
}

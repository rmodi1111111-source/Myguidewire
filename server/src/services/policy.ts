// Bind, issuance and policy servicing: the PolicyCenter policy lifecycle after quote.
//
//   Submission --bind--> Policy (term 1, model 1)
//   Policy Change  -> new model in the same term, pro-rata premium
//   Cancellation   -> new model with a cancellation date, return premium (pro rata / short rate / flat)
//   Reinstatement  -> new model that removes the cancellation
//   Renewal        -> new term

import { getDb, mapInvoice, mapPeriod, mapPolicy, mapSubjectivity, nextSequence, now, repo, transaction } from '../db.js';
import { PRODUCTS } from '../products/index.js';
import type { Invoice, JobType, Policy, PolicyPeriod, PolicyStatus, RiskData, Subjectivity, Submission, User, Version } from '../types.js';
import { JOB_TYPE_LABELS } from '../types.js';
import { WorkflowError, applicableForms, subjectivitiesFor } from './workflow.js';

const DAY = 86_400_000;
const ms = (d: string) => new Date(d.slice(0, 10) + 'T00:00:00Z').getTime();
export const today = () => new Date().toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY);
export const addDays = (d: string, n: number) => new Date(ms(d) + n * DAY).toISOString().slice(0, 10);
export function addMonths(d: string, n: number): string {
  const t = new Date(ms(d));
  t.setUTCMonth(t.getUTCMonth() + n);
  return t.toISOString().slice(0, 10);
}
const addYear = (d: string) => addMonths(d, 12);
const round = (n: number) => Math.round(n);
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

const POLICY_PREFIX: Record<string, string> = { CYBER: 'CYB', PROPERTY: 'CPP', GL: 'CGL' };

export const PAYMENT_PLANS: Record<string, { installments: number; downPct: number; months: number; fee: number }> = {
  'Full Pay': { installments: 1, downPct: 1, months: 0, fee: 0 },
  Quarterly: { installments: 4, downPct: 0.25, months: 3, fee: 5 },
  Monthly: { installments: 10, downPct: 0.19, months: 1, fee: 6 },
};
export const BILLING_METHODS = ['Direct Bill', 'Agency Bill'];

export const CANCELLATION_REASONS: Record<'Insured' | 'Carrier', { reason: string; noticeDays: number }[]> = {
  Insured: [
    { reason: 'Insured request - coverage replaced', noticeDays: 0 },
    { reason: 'Insured request - business sold or closed', noticeDays: 0 },
    { reason: 'Insured request - no longer needs coverage', noticeDays: 0 },
  ],
  Carrier: [
    { reason: 'Nonpayment of premium', noticeDays: 10 },
    { reason: 'Material misrepresentation', noticeDays: 30 },
    { reason: 'Substantial change in risk', noticeDays: 30 },
    { reason: 'Failure to comply with subjectivities', noticeDays: 30 },
  ],
};
export const CANCELLATION_METHODS = ['Pro Rata', 'Short Rate', 'Flat'] as const;

// ------------------------------------------------------------------ lookups

export function getPolicy(id: number): Policy {
  const r = getDb().prepare('SELECT * FROM policies WHERE id = ?').get(id);
  if (!r) throw new WorkflowError('Policy not found', 404);
  return mapPolicy(r);
}

export function periodsOf(policyId: number): PolicyPeriod[] {
  return getDb().prepare('SELECT * FROM policy_periods WHERE policy_id = ? ORDER BY term_number, model_number').all(policyId).map(mapPeriod);
}

/** The current (latest, non-superseded) model of each term. */
export function currentTerms(policyId: number): PolicyPeriod[] {
  return periodsOf(policyId).filter((p) => p.status === 'Current');
}

/** The term in effect on a date; otherwise the nearest term (first future term, else the latest). */
export function termAsOf(policyId: number, asOf = today()): PolicyPeriod | undefined {
  const terms = currentTerms(policyId);
  return terms.find((t) => t.periodStart <= asOf && asOf < t.periodEnd) ?? terms.find((t) => t.periodStart > asOf) ?? terms[terms.length - 1];
}

export function latestTerm(policyId: number): PolicyPeriod | undefined {
  const terms = currentTerms(policyId);
  return terms[terms.length - 1];
}

export function policyStatus(policyId: number, asOf = today()): PolicyStatus {
  const t = termAsOf(policyId, asOf);
  if (!t) return 'Expired';
  if (t.cancellationDate) return t.cancellationDate <= asOf ? 'Canceled' : 'Pending Cancellation';
  if (!t.issued) return 'Bound - Pending Issuance';
  if (asOf < t.periodStart) return 'Scheduled';
  if (asOf >= t.periodEnd) return 'Expired';
  return 'In Force';
}

export function subjectivities(subId: number): Subjectivity[] {
  return getDb().prepare('SELECT * FROM subjectivities WHERE submission_id = ? ORDER BY id').all(subId).map(mapSubjectivity);
}

/** Invoice run: installments are billed 20 days before they fall due. */
export const BILL_LEAD_DAYS = 20;
function runBilling(policyId: number) {
  getDb().prepare("UPDATE invoices SET status = 'Billed' WHERE policy_id = ? AND status = 'Planned' AND due_date <= ?").run(policyId, addDays(today(), BILL_LEAD_DAYS));
}

export function invoices(policyId: number): Invoice[] {
  runBilling(policyId);
  return getDb().prepare('SELECT * FROM invoices WHERE policy_id = ? ORDER BY due_date, id').all(policyId).map(mapInvoice);
}

function jobsOf(policyId: number): Submission[] {
  return repo.submissions('policy_id = ?', policyId);
}

const OPEN_STATUSES = ['INTAKE', 'CLEARANCE_REFERRAL', 'DRAFT', 'RATED', 'QUOTED'];

// ------------------------------------------------------------------ subjectivities

/** Subjectivities due "within N days of binding / of the effective date" are post-bind; everything else must be received before bind. */
export function subjectivityTiming(text: string): 'Prior to Bind' | 'Post Bind' {
  return /within \d+ days (of|after) (binding|the effective date)/i.test(text) ? 'Post Bind' : 'Prior to Bind';
}

/** Keep the subjectivity checklist in step with the quote: add new items, drop open items that no longer apply. */
export function syncSubjectivities(sub: Submission, versionId: number) {
  const wanted = subjectivitiesFor(sub, versionId);
  const existing = subjectivities(sub.id);
  const d = getDb();
  for (const text of wanted) {
    if (existing.some((e) => e.text === text)) continue;
    const timing = subjectivityTiming(text);
    const m = /within (\d+) days/i.exec(text);
    const due = timing === 'Post Bind' && m ? addDays(sub.effectiveDate, Number(m[1])) : null;
    d.prepare('INSERT INTO subjectivities(submission_id, text, timing, due_date, status) VALUES(?,?,?,?,?)').run(sub.id, text, timing, due, 'Open');
  }
  for (const e of existing) if (e.status === 'Open' && !wanted.includes(e.text)) d.prepare('DELETE FROM subjectivities WHERE id = ?').run(e.id);
}

export function decideSubjectivity(id: number, action: 'receive' | 'waive' | 'reopen', user: User): Subjectivity {
  const r = getDb().prepare('SELECT * FROM subjectivities WHERE id = ?').get(id);
  if (!r) throw new WorkflowError('Subjectivity not found', 404);
  const s = mapSubjectivity(r);
  if (user.authorityLevel < 1) throw new WorkflowError('Only underwriters can clear subjectivities.', 403);
  if (action === 'waive' && user.authorityLevel < 2) throw new WorkflowError('Waiving a subjectivity requires authority level 2.', 403);
  const status = action === 'receive' ? 'Received' : action === 'waive' ? 'Waived' : 'Open';
  getDb().prepare('UPDATE subjectivities SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?')
    .run(status, status === 'Open' ? null : user.name, status === 'Open' ? null : now(), id);
  repo.history(s.submissionId, null, `Subjectivity ${status.toLowerCase()}`, s.text, user.name);
  return mapSubjectivity(getDb().prepare('SELECT * FROM subjectivities WHERE id = ?').get(id)!);
}

// ------------------------------------------------------------------ premium summaries

export interface PremiumSummary {
  kind: JobType;
  priorAnnualPremium?: number;
  newAnnualPremium?: number;
  proRataFactor?: number;
  transactionPremium?: number;
  priorTermPremium?: number;
  newTermPremium?: number;
  daysRemaining?: number;
  termDays?: number;
}

function basePeriod(sub: Submission): PolicyPeriod | undefined {
  const id = sub.jobData?.basePeriodId;
  if (!id) return undefined;
  const r = getDb().prepare('SELECT * FROM policy_periods WHERE id = ?').get(id);
  return r ? mapPeriod(r) : undefined;
}

export const basePeriodOf = basePeriod;

export function premiumSummary(sub: Submission, v: Version | undefined): PremiumSummary | null {
  const base = basePeriod(sub);
  if (sub.jobType === 'Submission' || !base) return null;
  const termDays = daysBetween(base.periodStart, base.periodEnd);
  if (sub.jobType === 'PolicyChange') {
    const daysRemaining = daysBetween(sub.effectiveDate, base.periodEnd);
    const factor = daysRemaining / termDays;
    const out: PremiumSummary = { kind: 'PolicyChange', priorAnnualPremium: base.pricing.premium, proRataFactor: factor, priorTermPremium: base.termPremium, daysRemaining, termDays };
    if (v?.pricing) {
      out.newAnnualPremium = v.pricing.premium;
      out.transactionPremium = round((v.pricing.premium - base.pricing.premium) * factor);
      out.newTermPremium = base.termPremium + out.transactionPremium;
    }
    return out;
  }
  if (sub.jobType === 'Cancellation') {
    const ret = Number(sub.jobData.returnPremium) || 0;
    return { kind: 'Cancellation', priorTermPremium: base.termPremium, transactionPremium: -ret, newTermPremium: base.termPremium - ret, proRataFactor: sub.jobData.unearnedFactor, daysRemaining: daysBetween(sub.effectiveDate, base.periodEnd), termDays };
  }
  if (sub.jobType === 'Reinstatement') {
    const amt = Number(sub.jobData.reinstatePremium) || 0;
    return { kind: 'Reinstatement', priorTermPremium: base.termPremium, transactionPremium: amt, newTermPremium: base.termPremium + amt, termDays };
  }
  return { kind: 'Renewal', priorAnnualPremium: base.pricing.premium, newAnnualPremium: v?.pricing?.premium, transactionPremium: v?.pricing?.premium };
}

// ------------------------------------------------------------------ job creation

function createJob(args: {
  type: JobType;
  policy: Policy;
  base: PolicyPeriod;
  effectiveDate: string;
  expirationDate: string;
  status: Submission['status'];
  risk: RiskData;
  pricing?: PolicyPeriod['pricing'] | null;
  versionStatus: Version['status'];
  description: string;
  jobData: Record<string, unknown>;
  scan: unknown;
  user: User;
}): Submission {
  const { policy, base } = args;
  const original = repo.submission(base.jobId);
  const id = transaction(() => {
    const jobNumber = `${PRODUCTS[policy.product].abbreviation}-${nextSequence('job', 20000)}`;
    const ts = now();
    const r = getDb()
      .prepare(`INSERT INTO submissions(job_number, account_id, producer_id, product, status, underwriter_id, effective_date, expiration_date,
        received_date, source, priority, description, scan_json, job_type, policy_id, payment_plan, billing_method, job_json, created_at, updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(jobNumber, policy.accountId, policy.producerId, policy.product, args.status, policy.underwriterId, args.effectiveDate, args.expirationDate,
        ts.slice(0, 10), 'Policy Servicing', 'Normal', args.description, args.scan ? JSON.stringify(args.scan) : null, args.type, policy.id,
        original?.paymentPlan ?? 'Full Pay', original?.billingMethod ?? 'Direct Bill', JSON.stringify(args.jobData), ts, ts);
    const subId = Number(r.lastInsertRowid);
    const v = getDb()
      .prepare('INSERT INTO versions(submission_id, version_no, name, risk_json, pricing_json, status, created_at) VALUES(?,?,?,?,?,?,?)')
      .run(subId, 1, 'Version 1', JSON.stringify(args.risk), args.pricing ? JSON.stringify(args.pricing) : null, args.versionStatus, ts);
    const versionId = Number(v.lastInsertRowid);
    repo.updateSubmission(subId, { selected_version_id: versionId });
    if (args.type === 'PolicyChange') carryApprovals(base.jobId, subId, versionId);
    repo.history(subId, policy.accountId, `${JOB_TYPE_LABELS[args.type]} started`, `${jobNumber} on policy ${policy.policyNumber}${args.description ? ` - ${args.description}` : ''}`, args.user.name);
    return subId;
  });
  return repo.submission(id)!;
}

/**
 * Approvals carry forward to a policy change while the approved value is unchanged; rule
 * re-evaluation reopens any issue whose value differs (e.g. a higher limit).
 */
function carryApprovals(fromJobId: number, toJobId: number, toVersionId: number) {
  const from = repo.submission(fromJobId);
  if (!from?.selectedVersionId) return;
  for (const i of repo.issues(fromJobId, from.selectedVersionId)) {
    if (i.status !== 'Approved') continue;
    getDb().prepare(`INSERT INTO uw_issues(submission_id, version_id, code, short_description, long_description, blocking_point, required_authority, value, status, decided_by, decided_at, decision_note, subjectivity)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(toJobId, toVersionId, i.code, i.shortDescription, i.longDescription, i.blockingPoint, i.requiredAuthority, i.value, 'Approved', i.decidedBy, i.decidedAt,
        `Carried forward from ${from.jobNumber}${i.decisionNote ? `: ${i.decisionNote}` : ''}`, i.subjectivity);
  }
}

function assertNoOpenTransaction(policyId: number, types: JobType[]) {
  const open = jobsOf(policyId).find((j) => types.includes(j.jobType) && OPEN_STATUSES.includes(j.status));
  if (open) throw new WorkflowError(`${JOB_TYPE_LABELS[open.jobType]} ${open.jobNumber} is already open on this policy. Complete or withdraw it first.`, 409);
}

export function startPolicyChange(policyId: number, input: { effectiveDate: string; description: string }, user: User): Submission {
  const policy = getPolicy(policyId);
  if (user.authorityLevel < 1) throw new WorkflowError('Only underwriters can start a policy change.', 403);
  const eff = input.effectiveDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eff ?? '')) throw new WorkflowError('Change effective date is required.');
  const base = termAsOf(policyId, eff);
  if (!base || eff < base.periodStart || eff >= base.periodEnd) throw new WorkflowError('The change effective date must fall within a policy term.');
  if (base.cancellationDate && base.cancellationDate <= eff) throw new WorkflowError('The policy is canceled on that date.');
  if (!input.description?.trim()) throw new WorkflowError('Describe the change (e.g. "Add location", "Increase limit").');
  assertNoOpenTransaction(policyId, ['PolicyChange', 'Cancellation', 'Reinstatement']);
  return createJob({
    type: 'PolicyChange', policy, base, effectiveDate: eff, expirationDate: base.periodEnd, status: 'DRAFT', risk: base.risk, versionStatus: 'Draft',
    description: input.description.trim(), jobData: { basePeriodId: base.id }, scan: lastScan(policyId), user,
  });
}

export function cancellationTerms(base: PolicyPeriod, eff: string, method: string) {
  const termDays = daysBetween(base.periodStart, base.periodEnd);
  const unearnedFactor = Math.max(0, daysBetween(eff, base.periodEnd)) / termDays;
  const factor = method === 'Flat' ? 1 : method === 'Short Rate' ? unearnedFactor * 0.9 : unearnedFactor;
  return { unearnedFactor, returnPremium: round(base.termPremium * factor) };
}

export function startCancellation(policyId: number, input: { effectiveDate: string; source: 'Insured' | 'Carrier'; reason: string; method: string }, user: User): Submission {
  const policy = getPolicy(policyId);
  if (user.authorityLevel < 1) throw new WorkflowError('Only underwriters can cancel a policy.', 403);
  const eff = input.effectiveDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eff ?? '')) throw new WorkflowError('Cancellation effective date is required.');
  const base = termAsOf(policyId, eff);
  if (!base || eff < base.periodStart || eff >= base.periodEnd) throw new WorkflowError('The cancellation date must fall within a policy term.');
  if (base.cancellationDate) throw new WorkflowError('This term is already canceled.');
  const reasonDef = CANCELLATION_REASONS[input.source]?.find((r) => r.reason === input.reason);
  if (!reasonDef) throw new WorkflowError('Select a cancellation source and reason.');
  if (!(CANCELLATION_METHODS as readonly string[]).includes(input.method)) throw new WorkflowError('Select a refund method.');
  if (input.method === 'Flat' && eff !== base.periodStart) throw new WorkflowError('Flat cancellation is only allowed effective on the term start date.');
  if (input.method === 'Short Rate' && input.source !== 'Insured') throw new WorkflowError('Short-rate refunds apply only to insured-requested cancellations.');
  const earliest = addDays(today(), reasonDef.noticeDays);
  if (input.source === 'Carrier' && eff < earliest && user.authorityLevel < 3) {
    throw new WorkflowError(`${input.reason} requires ${reasonDef.noticeDays} days' notice: the earliest effective date is ${earliest}. A manager can override.`);
  }
  if (input.source === 'Insured' && eff < addDays(today(), -30) && user.authorityLevel < 3) {
    throw new WorkflowError('Insured-requested cancellations can be backdated up to 30 days. A manager can override.');
  }
  assertNoOpenTransaction(policyId, ['PolicyChange', 'Cancellation', 'Reinstatement']);
  const terms = cancellationTerms(base, eff, input.method);
  return createJob({
    type: 'Cancellation', policy, base, effectiveDate: eff, expirationDate: base.periodEnd, status: 'QUOTED', risk: base.risk, pricing: base.pricing,
    versionStatus: 'Quoted', description: input.reason,
    jobData: { basePeriodId: base.id, source: input.source, reason: input.reason, method: input.method, noticeDays: reasonDef.noticeDays, ...terms },
    scan: null, user,
  });
}

export function startReinstatement(policyId: number, input: { reason: string }, user: User): Submission {
  const policy = getPolicy(policyId);
  if (user.authorityLevel < 2) throw new WorkflowError('Reinstatement requires authority level 2.', 403);
  const base = currentTerms(policyId).find((t) => t.cancellationDate);
  if (!base) throw new WorkflowError('The policy is not canceled.');
  if (daysBetween(base.cancellationDate!, today()) > 60 && user.authorityLevel < 3) throw new WorkflowError('Policies canceled more than 60 days ago must be rewritten. A manager can override.');
  if (!input.reason?.trim()) throw new WorkflowError('A reinstatement reason is required.');
  const cancelJob = repo.submission(base.jobId);
  assertNoOpenTransaction(policyId, ['PolicyChange', 'Cancellation', 'Reinstatement']);
  return createJob({
    type: 'Reinstatement', policy, base, effectiveDate: base.cancellationDate!, expirationDate: base.periodEnd, status: 'QUOTED', risk: base.risk,
    pricing: base.pricing, versionStatus: 'Quoted', description: input.reason.trim(),
    jobData: { basePeriodId: base.id, reason: input.reason.trim(), cancellationJobId: cancelJob?.id ?? null, reinstatePremium: -base.transactionPremium },
    scan: null, user,
  });
}

export function startRenewal(policyId: number, user: User): Submission {
  const policy = getPolicy(policyId);
  if (user.authorityLevel < 1) throw new WorkflowError('Only underwriters can renew a policy.', 403);
  const base = latestTerm(policyId);
  if (!base) throw new WorkflowError('Policy has no terms.');
  if (base.cancellationDate) throw new WorkflowError('A canceled policy cannot be renewed.');
  if (policy.nonRenewalReason) throw new WorkflowError(`The policy has been non-renewed: ${policy.nonRenewalReason}`);
  const days = daysBetween(today(), base.periodEnd);
  if (days > 120) throw new WorkflowError(`Renewals open 120 days before expiration. This term expires ${base.periodEnd} (${days} days).`);
  if (jobsOf(policyId).some((j) => j.jobType === 'Renewal' && j.effectiveDate === base.periodEnd && !['WITHDRAWN', 'DECLINED'].includes(j.status))) {
    throw new WorkflowError('A renewal already exists for this term.');
  }
  return createJob({
    type: 'Renewal', policy, base, effectiveDate: base.periodEnd, expirationDate: addYear(base.periodEnd), status: 'DRAFT', risk: base.risk,
    versionStatus: 'Draft', description: `Renewal of term ${base.termNumber}`, jobData: { basePeriodId: base.id }, scan: null, user,
  });
}

function lastScan(policyId: number) {
  return jobsOf(policyId).find((j) => j.scan)?.scan ?? null;
}

export function nonRenew(jobId: number, reason: string, user: User): Submission {
  const job = repo.submission(jobId);
  if (!job || job.jobType !== 'Renewal') throw new WorkflowError('Renewal not found', 404);
  if (!OPEN_STATUSES.includes(job.status)) throw new WorkflowError('This renewal is already closed.', 409);
  if (user.authorityLevel < 2) throw new WorkflowError('Non-renewal requires authority level 2.', 403);
  if (!reason?.trim()) throw new WorkflowError('A non-renewal reason is required.');
  const policy = getPolicy(job.policyId!);
  transaction(() => {
    getDb().prepare('UPDATE policies SET non_renewal_reason = ? WHERE id = ?').run(reason.trim(), policy.id);
    repo.updateSubmission(jobId, { status: 'NON_RENEWED', decline_reason: reason.trim() });
    const base = basePeriod(job)!;
    addDocument(job, policy, 'Non-Renewal Notice', base, { reason: reason.trim(), noticeDate: today() });
    repo.history(jobId, policy.accountId, 'Non-renewed', reason, user.name);
  });
  return repo.submission(jobId)!;
}

// ------------------------------------------------------------------ bind & issue

export function bindBlockers(sub: Submission): string[] {
  const out: string[] = [];
  if (sub.status !== 'QUOTED') out.push(sub.jobType === 'Submission' || sub.jobType === 'Renewal' ? 'Issue a quote before binding.' : 'Quote the transaction before issuing it.');
  if (sub.selectedVersionId) {
    for (const i of repo.issues(sub.id, sub.selectedVersionId)) {
      if (i.blockingPoint === 'Informational') continue;
      if (i.status === 'Open') out.push(`Open UW issue blocks bind: ${i.shortDescription} (requires authority ${i.requiredAuthority})`);
      if (i.status === 'Rejected') out.push(`Rejected UW issue: ${i.shortDescription}`);
    }
  }
  for (const s of subjectivities(sub.id)) if (s.timing === 'Prior to Bind' && s.status === 'Open') out.push(`Subjectivity not received: ${s.text}`);
  if (sub.policyId && (sub.jobType === 'PolicyChange' || sub.jobType === 'Cancellation')) {
    const base = basePeriod(sub);
    if (base && base.status !== 'Current') out.push('The policy changed after this transaction started. Withdraw it and start a new one.');
  }
  const producer = repo.producer(sub.producerId);
  if (producer && !producer.active && sub.jobType === 'Submission') out.push(`${producer.name} is not an active producer.`);
  return out;
}

function addDocument(job: Submission, policy: Policy, kind: string, period: PolicyPeriod, extra: Record<string, unknown> = {}) {
  const account = repo.account(policy.accountId)!;
  const producer = repo.producer(policy.producerId)!;
  const uw = policy.underwriterId ? repo.user(policy.underwriterId) : undefined;
  const snapshot = {
    kind, policyNumber: policy.policyNumber, product: policy.product, productName: PRODUCTS[policy.product].name,
    jobNumber: job.jobNumber, jobType: job.jobType, generatedAt: now(),
    account, producer, underwriter: uw ? { name: uw.name, email: uw.email } : null,
    termNumber: period.termNumber, periodStart: period.periodStart, periodEnd: period.periodEnd, editEffectiveDate: period.editEffectiveDate,
    risk: period.risk, pricing: period.pricing, transactionPremium: period.transactionPremium, termPremium: period.termPremium,
    cancellationDate: period.cancellationDate, forms: applicableForms(period.risk), paymentPlan: job.paymentPlan, billingMethod: job.billingMethod,
    ...extra,
  };
  getDb().prepare('INSERT INTO documents(submission_id, policy_id, name, doc_type, mime_type, doc_json, uploaded_by, created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(job.id, policy.id, `${kind} - ${policy.policyNumber}`, kind, 'text/html', JSON.stringify(snapshot), 'System', now());
}

function insertPeriod(p: Omit<PolicyPeriod, 'id' | 'createdAt' | 'status'>): PolicyPeriod {
  const r = getDb()
    .prepare(`INSERT INTO policy_periods(policy_id, term_number, model_number, period_start, period_end, edit_effective_date, job_id, risk_json, pricing_json,
      transaction_premium, term_premium, cancellation_date, issued, status, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(p.policyId, p.termNumber, p.modelNumber, p.periodStart, p.periodEnd, p.editEffectiveDate, p.jobId, JSON.stringify(p.risk), JSON.stringify(p.pricing),
      round(p.transactionPremium), round(p.termPremium), p.cancellationDate, p.issued ? 1 : 0, 'Current', now());
  return mapPeriod(getDb().prepare('SELECT * FROM policy_periods WHERE id = ?').get(Number(r.lastInsertRowid))!);
}

function supersede(periodId: number) {
  getDb().prepare("UPDATE policy_periods SET status = 'Superseded' WHERE id = ?").run(periodId);
}

function addInvoice(policyId: number, jobId: number, description: string, dueDate: string, amount: number, status: Invoice['status']): number {
  const r = getDb().prepare('INSERT INTO invoices(policy_id, job_id, invoice_number, description, due_date, amount, status) VALUES(?,?,?,?,?,?,?)')
    .run(policyId, jobId, `INV-${nextSequence('invoice', 700000)}`, description, dueDate, round(amount), status);
  return Number(r.lastInsertRowid);
}

/** Build the installment schedule for a new term. */
export function scheduleInstallments(policyId: number, jobId: number, total: number, plan: string, start: string) {
  const p = PAYMENT_PLANS[plan] ?? PAYMENT_PLANS['Full Pay'];
  if (p.installments === 1) {
    addInvoice(policyId, jobId, 'Full payment', start, total, 'Billed');
    return;
  }
  const down = round(total * p.downPct);
  const rest = total - down;
  const each = round(rest / (p.installments - 1));
  addInvoice(policyId, jobId, `Down payment (${plan})`, start, down, 'Billed');
  for (let i = 1; i < p.installments; i++) {
    const amount = i === p.installments - 1 ? rest - each * (p.installments - 2) : each;
    addInvoice(policyId, jobId, `Installment ${i + 1} of ${p.installments} (incl. $${p.fee} fee)`, addMonths(start, i * p.months), amount + p.fee, 'Planned');
  }
}

export function bindJob(jobId: number, opts: { issue?: boolean }, user: User): Submission {
  const job = repo.submission(jobId);
  if (!job) throw new WorkflowError('Transaction not found', 404);
  if (user.authorityLevel < 1) throw new WorkflowError('Only underwriters can bind.', 403);
  const blockers = bindBlockers(job);
  if (blockers.length) throw new WorkflowError('Bind is blocked.', 409, blockers);
  const v = job.selectedVersionId ? repo.version(job.selectedVersionId) : undefined;
  if (!v?.pricing) throw new WorkflowError('The transaction has no rated version.');
  const issue = opts.issue !== false;

  transaction(() => {
    const ts = now();
    if (job.jobType === 'Submission') {
      const policyNumber = `${POLICY_PREFIX[job.product]}-${nextSequence('policy', 1000000)}`;
      const r = getDb().prepare('INSERT INTO policies(policy_number, account_id, product, producer_id, underwriter_id, original_effective_date, created_at) VALUES(?,?,?,?,?,?,?)')
        .run(policyNumber, job.accountId, job.product, job.producerId, job.underwriterId, job.effectiveDate, ts);
      const policyId = Number(r.lastInsertRowid);
      const policy = getPolicy(policyId);
      const period = insertPeriod({
        policyId, termNumber: 1, modelNumber: 1, periodStart: job.effectiveDate, periodEnd: job.expirationDate, editEffectiveDate: job.effectiveDate,
        jobId, risk: v.risk, pricing: v.pricing!, transactionPremium: v.pricing!.premium, termPremium: v.pricing!.premium, cancellationDate: null, issued: issue,
      });
      scheduleInstallments(policyId, jobId, v.pricing!.totalCost, job.paymentPlan, job.effectiveDate);
      repo.updateSubmission(jobId, { status: 'BOUND', policy_id: policyId });
      getDb().prepare("UPDATE quotes SET status = 'Bound' WHERE submission_id = ? AND status = 'Active'").run(jobId);
      addDocument({ ...job, policyId }, policy, 'Binder', period, { subjectivities: subjectivities(jobId) });
      if (issue) addDocument({ ...job, policyId }, policy, 'Declarations', period);
      followUpPostBind(job);
      repo.history(jobId, job.accountId, issue ? 'Bound and issued' : 'Bound', `Policy ${policyNumber} - premium ${money(v.pricing!.premium)}, ${job.paymentPlan}`, user.name);
    } else {
      const policy = getPolicy(job.policyId!);
      const base = basePeriod(job)!;
      if (job.jobType === 'Renewal') {
        const period = insertPeriod({
          policyId: policy.id, termNumber: base.termNumber + 1, modelNumber: 1, periodStart: job.effectiveDate, periodEnd: job.expirationDate,
          editEffectiveDate: job.effectiveDate, jobId, risk: v.risk, pricing: v.pricing!, transactionPremium: v.pricing!.premium,
          termPremium: v.pricing!.premium, cancellationDate: null, issued: true,
        });
        scheduleInstallments(policy.id, jobId, v.pricing!.totalCost, job.paymentPlan, job.effectiveDate);
        getDb().prepare("UPDATE quotes SET status = 'Bound' WHERE submission_id = ? AND status = 'Active'").run(jobId);
        addDocument(job, policy, 'Renewal Declarations', period);
        followUpPostBind(job);
        repo.history(jobId, policy.accountId, 'Renewal issued', `Term ${period.termNumber} ${period.periodStart} - ${period.periodEnd}, premium ${money(v.pricing!.premium)}`, user.name);
      } else if (job.jobType === 'PolicyChange') {
        const sum = premiumSummary(job, v)!;
        supersede(base.id);
        const period = insertPeriod({
          ...pick(base), modelNumber: nextModel(policy.id, base.termNumber), editEffectiveDate: job.effectiveDate, jobId, risk: v.risk, pricing: v.pricing!,
          transactionPremium: sum.transactionPremium!, termPremium: sum.newTermPremium!, cancellationDate: null, issued: true,
        });
        if (sum.transactionPremium) {
          addInvoice(policy.id, jobId, `Policy change ${job.jobNumber}: ${job.description}`, job.effectiveDate > today() ? job.effectiveDate : today(), sum.transactionPremium, 'Billed');
        }
        getDb().prepare("UPDATE quotes SET status = 'Bound' WHERE submission_id = ? AND status = 'Active'").run(jobId);
        addDocument(job, policy, 'Policy Change Endorsement', period, { description: job.description, priorAnnualPremium: sum.priorAnnualPremium, newAnnualPremium: sum.newAnnualPremium });
        repo.history(jobId, policy.accountId, 'Policy change issued', `${job.description}: ${sum.transactionPremium! >= 0 ? 'additional' : 'return'} premium ${money(Math.abs(sum.transactionPremium!))}`, user.name);
      } else if (job.jobType === 'Cancellation') {
        const ret = Number(job.jobData.returnPremium) || 0;
        supersede(base.id);
        const period = insertPeriod({
          ...pick(base), modelNumber: nextModel(policy.id, base.termNumber), editEffectiveDate: job.effectiveDate, jobId, risk: base.risk, pricing: base.pricing,
          transactionPremium: -ret, termPremium: base.termPremium - ret, cancellationDate: job.effectiveDate, issued: base.issued,
        });
        // Stop future installments and settle the difference between what was billed and what is earned.
        const future = invoices(policy.id).filter((i) => i.status === 'Planned' && i.dueDate > job.effectiveDate);
        const cancelledAmount = future.reduce((s, i) => s + i.amount, 0);
        for (const i of future) getDb().prepare("UPDATE invoices SET status = 'Cancelled' WHERE id = ?").run(i.id);
        // Unbilled installments that will no longer be billed (C) versus premium returned (R):
        // C > R -> the insured still owes earned premium; C < R -> the insured gets a credit.
        const net = round(cancelledAmount - ret);
        const adjustmentId = net !== 0
          ? addInvoice(policy.id, jobId, net > 0 ? 'Cancellation - earned premium due' : 'Cancellation - return premium credit', today(), net, 'Billed')
          : null;
        getDb().prepare('UPDATE submissions SET job_json = ? WHERE id = ?').run(JSON.stringify({ ...job.jobData, cancelledInvoiceIds: future.map((i) => i.id), adjustmentInvoiceId: adjustmentId }), jobId);
        addDocument(job, policy, 'Cancellation Notice', period, { source: job.jobData.source, reason: job.jobData.reason, method: job.jobData.method, returnPremium: ret });
        repo.history(jobId, policy.accountId, 'Cancellation bound', `${job.jobData.reason}, effective ${job.effectiveDate}, ${job.jobData.method} return premium ${money(ret)}`, user.name);
      } else if (job.jobType === 'Reinstatement') {
        const amt = Number(job.jobData.reinstatePremium) || 0;
        supersede(base.id);
        const period = insertPeriod({
          ...pick(base), modelNumber: nextModel(policy.id, base.termNumber), editEffectiveDate: job.effectiveDate, jobId, risk: base.risk, pricing: base.pricing,
          transactionPremium: amt, termPremium: base.termPremium + amt, cancellationDate: null, issued: base.issued,
        });
        const cancelJob = job.jobData.cancellationJobId ? repo.submission(job.jobData.cancellationJobId) : undefined;
        for (const id of cancelJob?.jobData.cancelledInvoiceIds ?? []) getDb().prepare("UPDATE invoices SET status = 'Planned' WHERE id = ? AND status = 'Cancelled'").run(id);
        if (cancelJob?.jobData.adjustmentInvoiceId) getDb().prepare("UPDATE invoices SET status = 'Cancelled' WHERE id = ? AND status <> 'Paid'").run(cancelJob.jobData.adjustmentInvoiceId);
        addDocument(job, policy, 'Reinstatement Notice', period, { reason: job.jobData.reason, reinstatePremium: amt });
        repo.history(jobId, policy.accountId, 'Policy reinstated', `${job.jobData.reason}; premium ${money(amt)} reinstated`, user.name);
      }
      repo.updateSubmission(jobId, { status: 'BOUND' });
    }
    getDb().prepare("UPDATE versions SET status = 'Bound' WHERE id = ?").run(v.id);
    getDb().prepare("UPDATE activities SET status = 'Completed', completed_at = ? WHERE submission_id = ? AND status = 'Open'").run(now(), jobId);
  });
  return repo.submission(jobId)!;
}

function pick(base: PolicyPeriod) {
  return { policyId: base.policyId, termNumber: base.termNumber, periodStart: base.periodStart, periodEnd: base.periodEnd };
}

function nextModel(policyId: number, term: number): number {
  const r = getDb().prepare('SELECT MAX(model_number) AS m FROM policy_periods WHERE policy_id = ? AND term_number = ?').get(policyId, term) as { m: number };
  return (r?.m ?? 0) + 1;
}

function followUpPostBind(job: Submission) {
  const post = subjectivities(job.id).filter((s) => s.timing === 'Post Bind' && s.status === 'Open');
  if (!post.length) return;
  const due = post.map((s) => s.dueDate).filter(Boolean).sort()[0] ?? addDays(job.effectiveDate, 30);
  repo.activity({ submissionId: null, accountId: job.accountId, subject: `Collect post-bind subjectivities (${job.jobNumber})`, description: post.map((s) => s.text).join('\n'), assignedTo: job.underwriterId, priority: 'Normal', dueDate: due });
}

export function issuePolicy(policyId: number, user: User) {
  const policy = getPolicy(policyId);
  if (user.authorityLevel < 1) throw new WorkflowError('Only underwriters can issue policies.', 403);
  const t = currentTerms(policyId).find((p) => !p.issued);
  if (!t) throw new WorkflowError('The policy is already issued.', 409);
  getDb().prepare('UPDATE policy_periods SET issued = 1 WHERE id = ?').run(t.id);
  const job = repo.submission(t.jobId)!;
  addDocument(job, policy, 'Declarations', { ...t, issued: true });
  repo.history(t.jobId, policy.accountId, 'Policy issued', policy.policyNumber, user.name);
}

export function payInvoice(invoiceId: number, user: User) {
  const r = getDb().prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!r) throw new WorkflowError('Invoice not found', 404);
  const inv = mapInvoice(r);
  if (inv.status === 'Paid' || inv.status === 'Cancelled') throw new WorkflowError(`Invoice is already ${inv.status.toLowerCase()}.`, 409);
  getDb().prepare("UPDATE invoices SET status = 'Paid', paid_at = ? WHERE id = ?").run(now(), invoiceId);
  repo.history(inv.jobId, null, inv.amount < 0 ? 'Refund issued' : 'Payment received', `${inv.invoiceNumber} ${money(Math.abs(inv.amount))}`, user.name);
  return mapInvoice(getDb().prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId)!);
}

// ------------------------------------------------------------------ read models

export function policySummaryRow(p: Policy) {
  const t = termAsOf(p.id);
  const account = repo.account(p.accountId);
  return {
    id: p.id, policyNumber: p.policyNumber, product: p.product, productName: PRODUCTS[p.product].name, status: policyStatus(p.id),
    accountId: p.accountId, accountName: account?.name ?? '', state: account?.state ?? '', producerName: repo.producer(p.producerId)?.name ?? '',
    underwriterName: p.underwriterId ? repo.user(p.underwriterId)?.name ?? null : null,
    periodStart: t?.periodStart, periodEnd: t?.periodEnd, termNumber: t?.termNumber, termPremium: t?.termPremium ?? 0,
  };
}

export function policyDetail(policyId: number) {
  const policy = getPolicy(policyId);
  const periods = periodsOf(policyId);
  const current = termAsOf(policyId);
  const jobs = jobsOf(policyId).sort((a, b) => a.id - b.id);
  const inv = invoices(policyId);
  const d = getDb();
  const latest = latestTerm(policyId);
  // The renewal of the term in effect today (once bound, the renewal term itself is the latest term).
  const renewal = current ? jobs.find((j) => j.jobType === 'Renewal' && j.effectiveDate === current.periodEnd && !['WITHDRAWN', 'DECLINED'].includes(j.status)) : undefined;
  const live = inv.filter((i) => i.status !== 'Cancelled');
  const jobIds = jobs.map((j) => j.id);
  return {
    policy,
    summary: policySummaryRow(policy),
    account: repo.account(policy.accountId),
    producer: repo.producer(policy.producerId),
    underwriter: policy.underwriterId ? repo.user(policy.underwriterId) : null,
    currentPeriod: current,
    periods,
    transactions: jobs.map((j) => {
      const created = periods.find((p) => p.jobId === j.id);
      return {
        id: j.id, jobNumber: j.jobNumber, jobType: j.jobType, jobTypeLabel: JOB_TYPE_LABELS[j.jobType], status: j.status, effectiveDate: j.effectiveDate,
        description: j.description, transactionPremium: created?.transactionPremium ?? null, termNumber: created?.termNumber ?? null,
        modelNumber: created?.modelNumber ?? null, createdAt: j.createdAt,
      };
    }),
    openTransactions: jobs.filter((j) => OPEN_STATUSES.includes(j.status)).map((j) => ({ id: j.id, jobNumber: j.jobNumber, jobTypeLabel: JOB_TYPE_LABELS[j.jobType], status: j.status })),
    invoices: inv,
    billing: {
      billed: live.filter((i) => i.status !== 'Planned').reduce((s, i) => s + i.amount, 0),
      paid: live.filter((i) => i.status === 'Paid').reduce((s, i) => s + i.amount, 0),
      outstanding: live.filter((i) => i.status === 'Billed').reduce((s, i) => s + i.amount, 0),
      unbilled: live.filter((i) => i.status === 'Planned').reduce((s, i) => s + i.amount, 0),
      paymentPlan: jobs[0]?.paymentPlan, billingMethod: jobs[0]?.billingMethod,
    },
    renewal: renewal ? { id: renewal.id, jobNumber: renewal.jobNumber, status: renewal.status } : null,
    renewalWindowOpen: !!latest && daysBetween(today(), latest.periodEnd) <= 120,
    documents: d.prepare('SELECT id, name, doc_type AS docType, submission_id AS jobId, created_at AS createdAt FROM documents WHERE policy_id = ? ORDER BY id DESC').all(policyId),
    history: jobIds.length ? d.prepare(`SELECT h.*, s.job_number AS jobNumber FROM history h LEFT JOIN submissions s ON s.id = h.submission_id WHERE h.submission_id IN (${jobIds.map(() => '?').join(',')}) ORDER BY h.id DESC`).all(...jobIds) : [],
    reference: { cancellationReasons: CANCELLATION_REASONS, cancellationMethods: CANCELLATION_METHODS },
  };
}

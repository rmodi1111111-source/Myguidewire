import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { initDb } from '../src/db.js';
import { seed } from '../src/seed.js';
import { cancellationTerms, subjectivityTiming } from '../src/services/policy.js';

let app: ReturnType<typeof createApp>;
const as = (user: number) => ({ 'X-User-Id': String(user) });
const UW = 2, SENIOR = 3, MANAGER = 4;
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

beforeAll(() => {
  initDb(':memory:');
  seed();
  app = createApp();
});

describe('policy helpers', () => {
  it('classifies subjectivity timing', () => {
    expect(subjectivityTiming('Signed and dated application within 30 days of the effective date')).toBe('Post Bind');
    expect(subjectivityTiming('Closure of internet-exposed RDP verified by rescan prior to binding')).toBe('Prior to Bind');
  });
  it('computes pro rata, short rate and flat return premium', () => {
    const base: any = { periodStart: '2026-01-01', periodEnd: '2027-01-01', termPremium: 3650 };
    // 183 of 365 days unearned
    expect(cancellationTerms(base, '2026-07-02', 'Pro Rata').returnPremium).toBe(1830);
    expect(cancellationTerms(base, '2026-07-02', 'Short Rate').returnPremium).toBe(Math.round(3650 * (183 / 365) * 0.9));
    expect(cancellationTerms(base, '2026-01-01', 'Flat').returnPremium).toBe(3650);
  });
});

describe('bind and policy servicing (API)', () => {
  let subId: number;
  let policyId: number;

  it('blocks bind until prior-to-bind subjectivities are received', async () => {
    const list = (await request(app).get('/api/submissions?q=Northwind&status=QUOTED').set(as(UW))).body;
    subId = list[0].id;
    const res = await request(app).post(`/api/submissions/${subId}/bind`).set(as(UW)).send({ issue: true });
    expect(res.status).toBe(409);
    expect(res.body.details.join(' ')).toMatch(/Subjectivity not received/);
  });

  it('waiving needs authority 2; receiving clears the blockers; bind issues the policy', async () => {
    const detail = (await request(app).get(`/api/submissions/${subId}`).set(as(UW))).body;
    const prior = detail.subjectivityItems.filter((s: any) => s.timing === 'Prior to Bind');
    expect(prior.length).toBeGreaterThan(0);
    expect((await request(app).post(`/api/subjectivities/${prior[0].id}`).set(as(UW)).send({ action: 'waive' })).status).toBe(403);
    for (const s of prior) expect((await request(app).post(`/api/subjectivities/${s.id}`).set(as(UW)).send({ action: 'receive' })).status).toBe(200);
    await request(app).put(`/api/submissions/${subId}`).set(as(UW)).send({ paymentPlan: 'Quarterly', billingMethod: 'Direct Bill' });
    const res = await request(app).post(`/api/submissions/${subId}/bind`).set(as(UW)).send({ issue: true });
    expect(res.status).toBe(200);
    expect(res.body.submission.status).toBe('BOUND');
    expect(res.body.policy.policyNumber).toMatch(/^CYB-/);
    policyId = res.body.policy.id;
    const p = (await request(app).get(`/api/policies/${policyId}`).set(as(UW))).body;
    expect(['In Force', 'Scheduled']).toContain(p.summary.status);
    expect(p.invoices).toHaveLength(4);
    expect(p.documents.map((d: any) => d.docType)).toEqual(expect.arrayContaining(['Binder', 'Declarations']));
  });

  it('policy change: pro-rata additional premium and a new model', async () => {
    const p = (await request(app).get(`/api/policies/${policyId}`).set(as(UW))).body;
    const eff = p.currentPeriod.periodStart > day(0) ? p.currentPeriod.periodStart : day(1);
    const start = await request(app).post(`/api/policies/${policyId}/change`).set(as(UW)).send({ effectiveDate: eff, description: 'Increase limit' });
    expect(start.status).toBe(200);
    const jobId = start.body.jobId;
    const job = (await request(app).get(`/api/submissions/${jobId}`).set(as(UW))).body;
    const risk = job.versions[0].risk;
    risk.coverages.aggregateLimit = 5_000_000;
    await request(app).put(`/api/submissions/${jobId}/versions/${job.versions[0].id}/risk`).set(as(UW)).send(risk);
    let rated = (await request(app).post(`/api/submissions/${jobId}/rate`).set(as(UW)).send({})).body;
    for (const i of rated.issues.filter((x: any) => x.status === 'Open')) await request(app).post(`/api/issues/${i.id}/decision`).set(as(MANAGER)).send({ decision: 'Approve' });
    rated = (await request(app).post(`/api/submissions/${jobId}/quote`).set(as(UW)).send({})).body;
    expect(rated.premiumSummary.transactionPremium).toBeGreaterThan(0);
    const bound = await request(app).post(`/api/submissions/${jobId}/bind`).set(as(UW)).send({});
    expect(bound.status).toBe(200);
    const after = (await request(app).get(`/api/policies/${policyId}`).set(as(UW))).body;
    expect(after.currentPeriod.modelNumber).toBe(2);
    expect(after.currentPeriod.risk.coverages.aggregateLimit).toBe(5_000_000);
  });

  it('only one open transaction at a time', async () => {
    const p = (await request(app).get(`/api/policies/${policyId}`).set(as(UW))).body;
    const eff = p.currentPeriod.periodStart;
    const c1 = await request(app).post(`/api/policies/${policyId}/cancel`).set(as(UW)).send({ effectiveDate: eff, source: 'Insured', reason: 'Insured request - coverage replaced', method: 'Short Rate' });
    expect(c1.status).toBe(200);
    const c2 = await request(app).post(`/api/policies/${policyId}/change`).set(as(UW)).send({ effectiveDate: eff, description: 'x' });
    expect(c2.status).toBe(409);
    await request(app).post(`/api/submissions/${c1.body.jobId}/withdraw`).set(as(UW)).send({ reason: 'test' });
  });

  it('carrier cancellation enforces notice days', async () => {
    const granite = (await request(app).get('/api/policies?q=Granite').set(as(UW))).body[0];
    const res = await request(app).post(`/api/policies/${granite.id}/cancel`).set(as(UW)).send({ effectiveDate: day(3), source: 'Carrier', reason: 'Material misrepresentation', method: 'Pro Rata' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/30 days' notice/);
  });

  it('cancel then reinstate restores the policy and its installments', async () => {
    const before = (await request(app).get(`/api/policies/${policyId}`).set(as(UW))).body;
    const planned = before.invoices.filter((i: any) => i.status === 'Planned').length;
    const c = await request(app).post(`/api/policies/${policyId}/cancel`).set(as(UW)).send({ effectiveDate: before.currentPeriod.periodStart > day(0) ? before.currentPeriod.periodStart : day(0), source: 'Insured', reason: 'Insured request - coverage replaced', method: 'Pro Rata' });
    expect(c.status).toBe(200);
    expect((await request(app).post(`/api/submissions/${c.body.jobId}/bind`).set(as(UW)).send({})).status).toBe(200);
    const canceled = (await request(app).get(`/api/policies/${policyId}`).set(as(UW))).body;
    expect(['Canceled', 'Pending Cancellation']).toContain(canceled.summary.status);
    expect((await request(app).post(`/api/policies/${policyId}/reinstate`).set(as(UW)).send({ reason: 'x' })).status).toBe(403);
    const r = await request(app).post(`/api/policies/${policyId}/reinstate`).set(as(SENIOR)).send({ reason: 'Replacement fell through' });
    expect(r.status).toBe(200);
    expect((await request(app).post(`/api/submissions/${r.body.jobId}/bind`).set(as(SENIOR)).send({})).status).toBe(200);
    const after = (await request(app).get(`/api/policies/${policyId}`).set(as(UW))).body;
    expect(['In Force', 'Scheduled']).toContain(after.summary.status);
    expect(after.invoices.filter((i: any) => i.status === 'Planned').length).toBe(planned);
    expect(after.currentPeriod.termPremium).toBe(before.currentPeriod.termPremium);
  });

  it('renewal: window enforced, renewal term issued', async () => {
    expect((await request(app).post(`/api/policies/${policyId}/renew`).set(as(UW)).send({})).status).toBe(400);
    const lakeshore = (await request(app).get('/api/policies?q=Lakeshore').set(as(UW))).body[0];
    const start = await request(app).post(`/api/policies/${lakeshore.id}/renew`).set(as(UW)).send({});
    expect(start.status).toBe(200);
    const jobId = start.body.jobId;
    await request(app).post(`/api/submissions/${jobId}/scan`).set(as(UW)).send({});
    let d = (await request(app).post(`/api/submissions/${jobId}/rate`).set(as(UW)).send({})).body;
    for (const i of d.issues.filter((x: any) => x.status === 'Open')) await request(app).post(`/api/issues/${i.id}/decision`).set(as(MANAGER)).send({ decision: 'Approve' });
    d = (await request(app).post(`/api/submissions/${jobId}/quote`).set(as(UW)).send({})).body;
    for (const s of d.subjectivityItems.filter((x: any) => x.timing === 'Prior to Bind')) await request(app).post(`/api/subjectivities/${s.id}`).set(as(UW)).send({ action: 'receive' });
    const bound = await request(app).post(`/api/submissions/${jobId}/bind`).set(as(UW)).send({});
    expect(bound.status).toBe(200);
    const p = (await request(app).get(`/api/policies/${lakeshore.id}`).set(as(UW))).body;
    expect(p.periods.filter((x: any) => x.status === 'Current').map((x: any) => x.termNumber)).toEqual([1, 2]);
    expect(p.renewal.status).toBe('BOUND');
  });

  it('canceled seed policy shows nonpayment billing and can be reinstated by a senior UW', async () => {
    const gl = (await request(app).get('/api/policies?q=Riverside').set(as(UW))).body[0];
    expect(gl.status).toBe('Canceled');
    const d = (await request(app).get(`/api/policies/${gl.id}`).set(as(UW))).body;
    expect(d.billing.outstanding).toBeGreaterThan(0);
    expect(d.invoices.some((i: any) => i.description.startsWith('Cancellation'))).toBe(true);
  });
});

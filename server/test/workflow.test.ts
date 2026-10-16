import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { initDb } from '../src/db.js';
import { seed } from '../src/seed.js';

let app: ReturnType<typeof createApp>;
const UW = 2; // Jordan Lee, authority 1
const SENIOR = 3; // authority 2
const MANAGER = 4; // authority 3
const as = (user: number) => ({ 'X-User-Id': String(user) });
const eff = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);

beforeAll(() => {
  initDb(':memory:');
  seed();
  app = createApp();
});

describe('pre-bind workflow (API)', () => {
  let subId: number;
  let versionId: number;

  it('intake creates an account + submission and auto-runs clearance', async () => {
    const res = await request(app).post('/api/submissions').set(as(1)).send({
      newAccount: { name: 'Riverbend Dental Group PC', fein: '45-1112223', naics: '621111', industry: 'Offices of Physicians', address1: '10 River Rd', city: 'Columbus', state: 'OH', zip: '43215', website: 'riverbenddental.com', yearsInBusiness: 12, annualRevenue: 9_000_000, employeeCount: 60 },
      producerId: 1, products: ['CYBER'], effectiveDate: eff, source: 'Broker Portal',
    });
    expect(res.status).toBe(200);
    const sub = res.body.submissions[0];
    expect(sub.jobNumber).toMatch(/^CY-/);
    expect(sub.clearance.outcome).toBe('PASS');
    expect(sub.status).toBe('DRAFT');
    subId = sub.id;
    versionId = sub.selectedVersionId;
  });

  it('rating is blocked by validation errors until the questionnaire is complete', async () => {
    const res = await request(app).post(`/api/submissions/${subId}/rate`).set(as(UW)).send({});
    expect(res.status).toBe(422);
    expect(res.body.details.some((d: any) => d.step === 'qualification')).toBe(true);
  });

  it('risk entry, CRP scan and rating', async () => {
    const detail = (await request(app).get(`/api/submissions/${subId}`).set(as(UW))).body;
    const risk = detail.versions[0].risk;
    risk.piiRecords = 50_000;
    risk.phiRecords = 80_000;
    risk.answers = {
      MFA_REMOTE: 'No', MFA_EMAIL: 'Yes', MFA_PRIVILEGED: 'Yes', EDR: 'Yes', BACKUPS_OFFLINE: 'Yes', PATCH_CADENCE: 'Within 30 days',
      EOL_SOFTWARE: 'No', ENCRYPTION: 'Yes', PCI_COMPLIANT: 'N/A - no card payments', TRAINING: 'Yes', WIRE_VERIFY: 'Yes', IR_PLAN: 'Yes',
      PRIOR_INCIDENTS: '0', PENDING_CLAIMS: 'No',
    };
    risk.noLossesCertified = true;
    expect((await request(app).put(`/api/submissions/${subId}/versions/${versionId}/risk`).set(as(UW)).send(risk)).status).toBe(200);
    const scanned = await request(app).post(`/api/submissions/${subId}/scan`).set(as(UW)).send({});
    expect(scanned.body.submission.scan.compositeScore).toBeGreaterThan(0);
    const rated = await request(app).post(`/api/submissions/${subId}/rate`).set(as(UW)).send({});
    expect(rated.status).toBe(200);
    expect(rated.body.submission.status).toBe('RATED');
    expect(rated.body.versions[0].pricing.premium).toBeGreaterThan(1000);
    expect(rated.body.issues.some((i: any) => i.code === 'CY_MFA_REMOTE' && i.status === 'Open')).toBe(true);
  });

  it('open blocking issues prevent quoting', async () => {
    const res = await request(app).post(`/api/submissions/${subId}/quote`).set(as(UW)).send({});
    expect(res.status).toBe(409);
    expect(res.body.details.join(' ')).toMatch(/MFA/);
  });

  it('enforces approval authority on UW issues', async () => {
    const detail = (await request(app).get(`/api/submissions/${subId}`).set(as(UW))).body;
    const mfa = detail.issues.find((i: any) => i.code === 'CY_MFA_REMOTE');
    expect((await request(app).post(`/api/issues/${mfa.id}/decision`).set(as(UW)).send({ decision: 'Approve' })).status).toBe(403);
    for (const i of detail.issues.filter((x: any) => x.status === 'Open' && x.blockingPoint === 'Quote')) {
      const r = await request(app).post(`/api/issues/${i.id}/decision`).set(as(MANAGER)).send({ decision: 'Approve', note: 'ok' });
      expect(r.status).toBe(200);
    }
  });

  it('issues a quote with a PDF proposal and locks the submission', async () => {
    const res = await request(app).post(`/api/submissions/${subId}/quote`).set(as(SENIOR)).send({});
    expect(res.status).toBe(200);
    expect(res.body.submission.status).toBe('QUOTED');
    const q = res.body.quotes[0];
    expect(q.quoteNumber).toMatch(/^QCY/);
    expect(res.body.documents.some((d: any) => d.quoteId === q.id)).toBe(true);
    const pdf = await request(app).get(`/api/quotes/${q.id}/pdf`).set(as(UW)).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    const detail = (await request(app).get(`/api/submissions/${subId}`).set(as(UW))).body;
    const edit = await request(app).put(`/api/submissions/${subId}/versions/${versionId}/risk`).set(as(UW)).send(detail.versions[0].risk);
    expect(edit.status).toBe(409);
  });

  it('edit quote supersedes the active quote and re-opens editing', async () => {
    const res = await request(app).post(`/api/submissions/${subId}/edit-quote`).set(as(UW)).send({});
    expect(res.body.submission.status).toBe('RATED');
    expect(res.body.quotes.every((q: any) => q.status === 'Superseded')).toBe(true);
  });

  it('changing a rated value resets its approval', async () => {
    const detail = (await request(app).get(`/api/submissions/${subId}`).set(as(UW))).body;
    const risk = detail.versions[0].risk;
    risk.coverages.aggregateLimit = 5_000_000;
    await request(app).put(`/api/submissions/${subId}/versions/${versionId}/risk`).set(as(UW)).send(risk);
    const rated = (await request(app).post(`/api/submissions/${subId}/rate`).set(as(UW)).send({})).body;
    const limit = rated.issues.find((i: any) => i.code === 'CY_LIMIT');
    expect(limit.status).toBe('Open');
    expect(limit.requiredAuthority).toBe(2);
    expect(rated.issues.find((i: any) => i.code === 'CY_MFA_REMOTE').status).toBe('Approved');
  });
});

describe('clearance scenarios', () => {
  it('seeded sanctions hit is auto-declined and needs manager override', async () => {
    const list = (await request(app).get('/api/submissions?q=Volkov').set(as(UW))).body;
    expect(list[0].status).toBe('DECLINED');
    expect((await request(app).post(`/api/submissions/${list[0].id}/clearance/override`).set(as(SENIOR)).send({ reason: 'x' })).status).toBe(403);
  });

  it('broker-of-record conflict is referred and can be cleared by a senior underwriter', async () => {
    const list = (await request(app).get('/api/submissions?status=CLEARANCE_REFERRAL').set(as(UW))).body;
    const bor = list.find((s: any) => s.producerName === 'Harborview Insurance Brokers');
    const detail = (await request(app).get(`/api/submissions/${bor.id}`).set(as(UW))).body;
    expect(detail.submission.clearance.checks.find((c: any) => c.code === 'DUPLICATE').details[0]).toMatch(/BROKER OF RECORD CONFLICT/);
    const res = await request(app).post(`/api/submissions/${bor.id}/clearance/override`).set(as(SENIOR)).send({ reason: 'BOR letter received' });
    expect(res.status).toBe(200);
    expect(res.body.submission.status).toBe('DRAFT');
  });

  it('broker intake API matches an existing account by FEIN', async () => {
    const res = await request(app).post('/api/intake').set(as(1)).send({
      account: { name: 'Bayside Logistics Incorporated', fein: '59-1234567' }, producerCode: 'P1004', products: ['GL'], effectiveDate: eff,
    });
    expect(res.status).toBe(200);
    expect(res.body.matchedExistingAccount).toBe(true);
    expect(res.body.submissions[0].jobNumber).toMatch(/^GL-/);
  });
});

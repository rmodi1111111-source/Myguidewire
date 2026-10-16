import { describe, expect, it } from 'vitest';
import { defaultCyberRisk } from '../src/products/cyber.js';
import { defaultGLRisk } from '../src/products/gl.js';
import { defaultPropertyRisk } from '../src/products/property.js';
import { band, lossExperience, scheduleModFactor } from '../src/services/rating/common.js';
import { controlsModifier, rateCyber, scanFactor } from '../src/services/rating/cyber.js';
import { rateGL } from '../src/services/rating/gl.js';
import { ageFactor, protectionClassFactor, rateProperty } from '../src/services/rating/property.js';
import type { Account, CrpScanResult } from '../src/types.js';

const account: Account = {
  id: 1, accountNumber: 'A1', name: 'Test Co', dba: '', fein: '11-1111111', entityType: 'LLC', naics: '541611', industry: 'Management Consulting',
  address1: '1 Main St', city: 'Columbus', state: 'OH', zip: '43215', website: 'testco.com', yearsInBusiness: 10, annualRevenue: 8_000_000,
  employeeCount: 50, contactName: '', contactEmail: '', contactPhone: '', status: 'Active', createdAt: '',
};
const scan = (score: number): CrpScanResult => ({ runAt: '', provider: 't', product: 'CYBER', compositeScore: score, grade: 'B', sections: [] });

describe('rating helpers', () => {
  it('band picks highest threshold not exceeding value', () => {
    expect(band(0, [[0, 'a'], [10, 'b']])).toBe('a');
    expect(band(10, [[0, 'a'], [10, 'b']])).toBe('b');
    expect(band(9.99, [[0, 'a'], [10, 'b']])).toBe('a');
  });
  it('schedule mod is clamped to +/-25%', () => {
    expect(scheduleModFactor(40)).toBe(1.25);
    expect(scheduleModFactor(-40)).toBe(0.75);
    expect(scheduleModFactor(10)).toBeCloseTo(1.1);
  });
  it('loss experience counts only losses in the last 5 years and flags large losses', () => {
    const le = lossExperience([
      { date: '2025-01-01', type: 'Fire', description: '', paid: 150_000, reserved: 0, status: 'Closed' },
      { date: '2010-01-01', type: 'Fire', description: '', paid: 1, reserved: 0, status: 'Closed' },
    ], '2026-06-01');
    expect(le.count).toBe(1);
    expect(le.largeLoss).toBe(true);
    expect(le.factor).toBeCloseTo(1.1);
  });
});

describe('cyber rating', () => {
  it('caps the controls modifier at -30%', () => {
    const answers = { MFA_REMOTE: 'Yes', MFA_EMAIL: 'Yes', MFA_PRIVILEGED: 'Yes', EDR: 'Yes', MDR_SOC: 'Yes', BACKUPS_OFFLINE: 'Yes', BACKUP_TESTED: 'Yes', PATCH_CADENCE: 'Within 7 days', ENCRYPTION: 'Yes', TRAINING: 'Yes', WIRE_VERIFY: 'Yes', IR_PLAN: 'Yes' };
    expect(controlsModifier(answers).capped).toBe(-0.3);
  });
  it('poor controls cost more than good controls', () => {
    const good = defaultCyberRisk(8_000_000);
    good.answers = { MFA_REMOTE: 'Yes', EDR: 'Yes', BACKUPS_OFFLINE: 'Yes' };
    const bad = defaultCyberRisk(8_000_000);
    bad.answers = { MFA_REMOTE: 'No', EDR: 'No', BACKUPS_OFFLINE: 'No' };
    expect(rateCyber(bad, account, scan(700), '2026-12-01').premium).toBeGreaterThan(rateCyber(good, account, scan(700), '2026-12-01').premium);
  });
  it('applies an unscanned load and rewards strong posture scores', () => {
    expect(scanFactor(null).factor).toBe(1.1);
    expect(scanFactor(scan(900)).factor).toBe(0.85);
    expect(scanFactor(scan(500)).factor).toBe(1.35);
  });
  it('higher limits increase premium and higher retentions reduce it', () => {
    const base = defaultCyberRisk(8_000_000);
    const p1 = rateCyber(base, account, scan(700), '2026-12-01').premium;
    const higher = structuredClone(base);
    higher.coverages.aggregateLimit = 5_000_000;
    const bigRet = structuredClone(base);
    bigRet.coverages.retention = 100_000;
    expect(rateCyber(higher, account, scan(700), '2026-12-01').premium).toBeGreaterThan(p1);
    expect(rateCyber(bigRet, account, scan(700), '2026-12-01').premium).toBeLessThan(p1);
  });
  it('enforces minimum premium and adds the policy fee', () => {
    const tiny = defaultCyberRisk(100_000);
    tiny.coverages.retention = 250_000;
    tiny.coverages.socialEngineeringLimit = 0;
    tiny.coverages.dependentBI = false;
    tiny.coverages.mediaLiability = false;
    tiny.answers = { MFA_REMOTE: 'Yes', MFA_EMAIL: 'Yes', EDR: 'Yes', BACKUPS_OFFLINE: 'Yes', MDR_SOC: 'Yes' };
    const p = rateCyber(tiny, account, scan(900), '2026-12-01');
    expect(p.premium).toBe(1_000);
    expect(p.minimumPremiumApplied).toBe(true);
    expect(p.totalCost).toBe(1_250);
  });
  it('premium lines sum to the total premium', () => {
    const p = rateCyber(defaultCyberRisk(30_000_000), account, scan(700), '2026-12-01');
    expect(p.lines.reduce((s, l) => s + l.premium, 0)).toBe(p.premium);
  });
});

describe('property rating', () => {
  const risk = () => {
    const r = defaultPropertyRisk({ address1: '1 Main St', city: 'Columbus', state: 'OH', zip: '43215' });
    r.buildings = [{ id: 'B1', locationId: 'L1', number: 1, description: '', constructionClass: 1, occupancy: 'Office', yearBuilt: 1990, roofYear: 2015, stories: 2, squareFeet: 10_000, sprinklerPct: 0, alarm: 'None', occupiedPct: 100, buildingValue: 1_000_000, bppValue: 200_000, biValue: 0 }];
    return r;
  };
  it('factor tables', () => {
    expect(protectionClassFactor(10)).toBe(1.9);
    expect(protectionClassFactor(2)).toBe(0.85);
    expect(ageFactor(1940)).toBe(1.25);
  });
  it('fire resistive and sprinklered buildings rate lower than frame', () => {
    const frame = rateProperty(risk(), account, '2026-12-01').premium;
    const fr = risk();
    fr.buildings[0].constructionClass = 6;
    fr.buildings[0].sprinklerPct = 100;
    expect(rateProperty(fr, account, '2026-12-01').premium).toBeLessThan(frame);
  });
  it('earthquake adds a premium line only when elected', () => {
    const r = risk();
    expect(rateProperty(r, account, '2026-12-01').lines.some((l) => l.coverage === 'Earthquake')).toBe(false);
    r.coverages.earthquake = true;
    expect(rateProperty(r, account, '2026-12-01').lines.some((l) => l.coverage === 'Earthquake')).toBe(true);
  });
});

describe('GL rating', () => {
  it('rates per $1,000 of sales with territory and ILF', () => {
    const r = defaultGLRisk({ address1: '', city: '', state: 'OH', zip: '' });
    r.exposures = [{ id: 'E1', locationId: 'L1', classCode: '10010', exposure: 1_000_000 }];
    r.coverages.blanketAdditionalInsured = false;
    r.noLossesCertified = true;
    const p = rateGL(r, account, '2026-12-01');
    // (1000 units * 0.48 premOps + 1000 * 0.14 products) * terr 1.0 * ILF 1.0 * ded 1.0 * loss 0.95 = 589
    expect(p.premium).toBe(589);
    r.locations[0].state = 'NY';
    expect(rateGL(r, account, '2026-12-01').premium).toBeGreaterThan(589);
  });
});

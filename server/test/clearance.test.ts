import { describe, expect, it } from 'vitest';
import { nameSimilarity, sanctionsCheck, worst } from '../src/services/clearance.js';
import { SimulatedCrpProvider, cyberDomainFindings, locationHazard } from '../src/services/scan/crp.js';
import { defaultCyberRisk } from '../src/products/cyber.js';
import type { Account } from '../src/types.js';

const acct = (name: string): Account => ({
  id: 1, accountNumber: 'A1', name, dba: '', fein: '', entityType: '', naics: '', industry: '', address1: '', city: '', state: 'NY', zip: '',
  website: 'example.com', yearsInBusiness: 5, annualRevenue: 1, employeeCount: 1, contactName: '', contactEmail: '', contactPhone: '', status: 'Active', createdAt: '',
});

describe('clearance', () => {
  it('name similarity ignores legal suffixes and punctuation', () => {
    expect(nameSimilarity('Acme Widgets, Inc.', 'ACME WIDGETS LLC')).toBe(1);
    expect(nameSimilarity('Acme Widgets', 'Zenith Labs')).toBe(0);
  });
  it('worst outcome wins', () => {
    expect(worst(['PASS', 'REFER', 'PASS'])).toBe('REFER');
    expect(worst(['REFER', 'DECLINE'])).toBe('DECLINE');
    expect(worst([])).toBe('PASS');
  });
  it('sanctions screening declines exact matches and refers partial matches', () => {
    expect(sanctionsCheck(acct('Volkov Maritime Trading LLC')).outcome).toBe('DECLINE');
    expect(sanctionsCheck(acct('Volkov Maritime Logistics')).outcome).toBe('REFER');
    expect(sanctionsCheck(acct('Sunrise Bakery')).outcome).toBe('PASS');
  });
});

describe('CRP scan', () => {
  it('is deterministic for the same domain', () => {
    expect(cyberDomainFindings('example.com')).toEqual(cyberDomainFindings('example.com'));
  });
  it('produces a score within 300-950 and a grade', () => {
    const risk = defaultCyberRisk(1_000_000, 10, 'example.com');
    const r = SimulatedCrpProvider.scan(acct('Example'), risk);
    expect(r.compositeScore).toBeGreaterThanOrEqual(300);
    expect(r.compositeScore).toBeLessThanOrEqual(950);
    expect(['A', 'B', 'C', 'D', 'F']).toContain(r.grade);
  });
  it('places inland locations in wind tier 3 and coastal FL in tier 1 or 2', () => {
    expect(locationHazard({ state: 'OH', zip: '43215', address1: 'x' }).windTier).toBe(3);
    expect([1, 2]).toContain(locationHazard({ state: 'FL', zip: '33605', address1: 'x' }).windTier);
  });
});

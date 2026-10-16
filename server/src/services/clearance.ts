import { repo } from '../db.js';
import { PRODUCTS } from '../products/index.js';
import { SANCTIONS_LIST, STATES } from '../products/reference.js';
import type { Account, CheckOutcome, ClearanceCheck, ClearanceResult, Producer, Submission } from '../types.js';

const STOP_WORDS = new Set(['inc', 'llc', 'corp', 'corporation', 'co', 'company', 'ltd', 'the', 'group', 'holdings', 'lp', 'llp', 'pc', 'and', '&']);

export function normalizeName(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOP_WORDS.has(t));
}

/** Token-set Jaccard similarity between two business names (0..1). */
export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeName(a));
  const tb = new Set(normalizeName(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

const normAddr = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const RANK: Record<CheckOutcome, number> = { PASS: 0, REFER: 1, DECLINE: 2 };

export function worst(outcomes: CheckOutcome[]): CheckOutcome {
  return outcomes.reduce<CheckOutcome>((w, o) => (RANK[o] > RANK[w] ? o : w), 'PASS');
}

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000;
}

/** Duplicate / broker-of-record conflict search across in-force submissions. */
export function duplicateCheck(sub: Submission, account: Account): ClearanceCheck {
  const others = repo
    .submissions("id != ? AND product = ? AND status NOT IN ('DECLINED','WITHDRAWN')", sub.id, sub.product)
    .filter((o) => daysBetween(o.effectiveDate, sub.effectiveDate) <= 120);
  const details: string[] = [];
  let outcome: CheckOutcome = 'PASS';
  for (const o of others) {
    const oa = repo.account(o.accountId);
    if (!oa) continue;
    const reasons: string[] = [];
    if (oa.id === account.id) reasons.push('same account');
    if (account.fein && oa.fein && oa.fein === account.fein) reasons.push('FEIN match');
    const sim = nameSimilarity(oa.name, account.name);
    if (oa.id !== account.id && sim >= 0.75) reasons.push(`name similarity ${(sim * 100).toFixed(0)}%`);
    if (oa.id !== account.id && account.address1 && normAddr(oa.address1 + oa.zip) === normAddr(account.address1 + account.zip)) reasons.push('address match');
    if (!reasons.length) continue;
    const producer = repo.producer(o.producerId);
    const conflict = o.producerId !== sub.producerId;
    details.push(
      `${o.jobNumber} (${oa.name}, eff ${o.effectiveDate}, ${producer?.name ?? 'unknown producer'}) - ${reasons.join(', ')}${conflict ? ' - BROKER OF RECORD CONFLICT' : ''}`,
    );
    outcome = 'REFER';
  }
  return {
    code: 'DUPLICATE',
    name: 'Duplicate / Broker of Record',
    outcome,
    message: outcome === 'PASS' ? 'No conflicting submissions found within 120 days of the effective date.' : `${details.length} potentially conflicting submission(s) found.`,
    details,
  };
}

export function sanctionsCheck(account: Account): ClearanceCheck {
  const hits = SANCTIONS_LIST.map((s) => ({ s, score: Math.max(nameSimilarity(s.name, account.name), account.dba ? nameSimilarity(s.name, account.dba) : 0) }))
    .filter((h) => h.score >= 0.5);
  const exact = hits.some((h) => h.score >= 0.85);
  return {
    code: 'SANCTIONS',
    name: 'Sanctions Screening (OFAC)',
    outcome: exact ? 'DECLINE' : hits.length ? 'REFER' : 'PASS',
    message: hits.length ? `${hits.length} potential restricted-party match(es).` : 'No match against the restricted-party list.',
    details: hits.map((h) => `${h.s.name} [${h.s.program}, ${h.s.country}] - ${(h.score * 100).toFixed(0)}% match`),
  };
}

export function appetiteCheck(sub: Submission, account: Account): ClearanceCheck {
  const a = PRODUCTS[sub.product].appetite;
  const details: string[] = [];
  const outcomes: CheckOutcome[] = [];
  if (a.declinedNaics[account.naics]) {
    details.push(a.declinedNaics[account.naics]);
    outcomes.push('DECLINE');
  }
  if (a.referredNaics[account.naics]) {
    details.push(a.referredNaics[account.naics]);
    outcomes.push('REFER');
  }
  if (a.excludedStates.includes(account.state)) {
    details.push(`${STATES[account.state] ?? account.state} is not an approved state for ${PRODUCTS[sub.product].name}`);
    outcomes.push('DECLINE');
  }
  if (a.maxRevenueDecline && account.annualRevenue > a.maxRevenueDecline) {
    details.push(`Revenue $${account.annualRevenue.toLocaleString()} exceeds maximum of $${a.maxRevenueDecline.toLocaleString()}`);
    outcomes.push('DECLINE');
  } else if (a.maxRevenueRefer && account.annualRevenue > a.maxRevenueRefer) {
    details.push(`Revenue $${account.annualRevenue.toLocaleString()} exceeds referral threshold of $${a.maxRevenueRefer.toLocaleString()}`);
    outcomes.push('REFER');
  }
  if (a.minYearsInBusiness && account.yearsInBusiness < a.minYearsInBusiness) {
    details.push(`Only ${account.yearsInBusiness} year(s) in business (minimum ${a.minYearsInBusiness})`);
    outcomes.push('REFER');
  }
  if (!account.naics) {
    details.push('NAICS code not provided - class of business cannot be validated');
    outcomes.push('REFER');
  }
  const outcome = worst(outcomes);
  return {
    code: 'APPETITE',
    name: 'Appetite & Eligibility',
    outcome,
    message: outcome === 'PASS' ? 'Risk is within product appetite.' : outcome === 'DECLINE' ? 'Risk is outside product appetite.' : 'Risk requires underwriting referral.',
    details,
  };
}

export function licensingCheck(producer: Producer | undefined, account: Account): ClearanceCheck {
  if (!producer) return { code: 'LICENSING', name: 'Producer Licensing', outcome: 'REFER', message: 'Producer not found.' };
  if (!producer.active) return { code: 'LICENSING', name: 'Producer Licensing', outcome: 'DECLINE', message: `${producer.name} is not an active appointed producer.` };
  const ok = producer.licensedStates.includes(account.state);
  return {
    code: 'LICENSING',
    name: 'Producer Licensing',
    outcome: ok ? 'PASS' : 'REFER',
    message: ok ? `${producer.name} is licensed in ${account.state}.` : `${producer.name} is not licensed in ${account.state}. Licensing must be verified before quote.`,
  };
}

export function dataCompletenessCheck(sub: Submission, account: Account): ClearanceCheck {
  const missing: string[] = [];
  if (!account.address1 || !account.state || !account.zip) missing.push('Insured mailing address');
  if (!account.fein) missing.push('FEIN');
  if (!account.annualRevenue) missing.push('Annual revenue');
  if (sub.product === 'CYBER' && !account.website) missing.push('Primary website / domain');
  return {
    code: 'COMPLETENESS',
    name: 'Submission Completeness',
    outcome: missing.length ? 'REFER' : 'PASS',
    message: missing.length ? 'Required intake data is missing.' : 'All required intake data present.',
    details: missing,
  };
}

export function runClearance(sub: Submission): ClearanceResult {
  const account = repo.account(sub.accountId);
  if (!account) throw new Error('Account not found');
  const producer = repo.producer(sub.producerId);
  const checks = [
    sanctionsCheck(account),
    duplicateCheck(sub, account),
    appetiteCheck(sub, account),
    licensingCheck(producer, account),
    dataCompletenessCheck(sub, account),
  ];
  return { runAt: new Date().toISOString(), outcome: worst(checks.map((c) => c.outcome)), checks };
}

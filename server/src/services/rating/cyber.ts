import { CYBER_QUESTIONS } from '../../products/cyber.js';
import { PRODUCTS } from '../../products/index.js';
import { industryFor } from '../../products/reference.js';
import type { Account, CrpScanResult, CyberRisk, PricingResult } from '../../types.js';
import { Worksheet, band, finalize, lossExperience, scheduleModFactor } from './common.js';

/** Base premium at $1M aggregate / $10K retention by revenue band. */
export const CYBER_BASE_BY_REVENUE: [number, number][] = [
  [0, 1_200],
  [1_000_000, 2_400],
  [5_000_000, 3_800],
  [10_000_000, 6_500],
  [25_000_000, 10_500],
  [50_000_000, 17_000],
  [100_000_000, 31_000],
  [250_000_000, 52_000],
  [500_000_000, 85_000],
];

export const CYBER_ILF: Record<number, number> = { 1_000_000: 1.0, 2_000_000: 1.6, 3_000_000: 2.05, 5_000_000: 2.8, 10_000_000: 4.2 };
export const CYBER_RETENTION_FACTOR: Record<number, number> = { 2_500: 1.12, 5_000: 1.06, 10_000: 1.0, 25_000: 0.92, 50_000: 0.85, 100_000: 0.78, 250_000: 0.68 };

export function recordsFactor(records: number): number {
  return band(records, [[0, 0.95], [10_000, 1.0], [100_000, 1.1], [1_000_000, 1.25], [10_000_000, 1.45]]);
}

export function scanFactor(scan: CrpScanResult | null): { factor: number; label: string } {
  if (!scan || scan.product !== 'CYBER') return { factor: 1.1, label: 'No CRP scan on file (unscanned load)' };
  const s = scan.compositeScore;
  const factor = band(s, [[0, 1.35], [550, 1.15], [650, 1.0], [750, 0.95], [850, 0.85]]);
  return { factor, label: `CRP posture score ${s} (grade ${scan.grade})` };
}

export function controlsModifier(answers: Record<string, string>): { total: number; capped: number; items: { code: string; answer: string; mod: number }[] } {
  const items: { code: string; answer: string; mod: number }[] = [];
  for (const q of CYBER_QUESTIONS) {
    const ans = answers[q.code];
    if (!q.rating || ans === undefined || ans === '') continue;
    const mod = q.rating[ans] ?? 0;
    if (mod !== 0) items.push({ code: q.code, answer: ans, mod });
  }
  const total = items.reduce((s, i) => s + i.mod, 0);
  return { total, capped: Math.max(-0.3, Math.min(0.5, total)), items };
}

export function rateCyber(risk: CyberRisk, account: Account, scan: CrpScanResult | null, effectiveDate: string): PricingResult {
  const ws = new Worksheet();
  const c = risk.coverages;
  const S = 'Base Premium';
  const revenue = Number(risk.annualRevenue) || 0;
  const base = band(revenue, CYBER_BASE_BY_REVENUE);
  ws.add(S, `Base premium for revenue $${revenue.toLocaleString()}`, undefined, base, 'Revenue band');

  const ind = industryFor(account.naics);
  const indFactor = ind?.cyberFactor ?? 1.0;
  ws.add(S, `Industry hazard - ${ind?.description ?? 'Unclassified'}`, indFactor);

  const ilf = CYBER_ILF[c.aggregateLimit] ?? 1;
  ws.add(S, `Increased limit factor - $${c.aggregateLimit.toLocaleString()} aggregate`, ilf);
  const ret = CYBER_RETENTION_FACTOR[c.retention] ?? 1;
  ws.add(S, `Retention factor - $${c.retention.toLocaleString()}`, ret);

  const records = (Number(risk.piiRecords) || 0) + 2 * (Number(risk.phiRecords) || 0) + (Number(risk.pciRecords) || 0);
  const recFactor = recordsFactor(records);
  ws.add(S, `Sensitive records factor (${records.toLocaleString()} weighted records; PHI x2)`, recFactor);

  const ctl = controlsModifier(risk.answers);
  for (const i of ctl.items) ws.add('Security Controls', `${i.code} = ${i.answer}`, `${i.mod > 0 ? '+' : ''}${(i.mod * 100).toFixed(1)}%`);
  const ctlFactor = 1 + ctl.capped;
  ws.add('Security Controls', `Controls modifier (sum ${(ctl.total * 100).toFixed(1)}%, capped -30%/+50%)`, ctlFactor);

  const sf = scanFactor(scan);
  ws.add('CRP Scan', sf.label, sf.factor);

  const answerIncidents = risk.answers.PRIOR_INCIDENTS === '2 or more' ? 2 : risk.answers.PRIOR_INCIDENTS === '1' ? 1 : 0;
  const le = lossExperience(risk.losses, effectiveDate);
  const incidents = Math.max(answerIncidents, le.count);
  const incFactor = incidents === 0 ? 1.0 : incidents === 1 ? 1.2 : 1.5;
  ws.add('Experience', `Prior incidents (${incidents})`, incFactor);

  const core = base * indFactor * ilf * ret * recFactor * ctlFactor * sf.factor * incFactor;
  ws.add('Core Premium', 'Core premium (base x factors)', undefined, core);

  // Ransomware structure
  let rwFactor = 1;
  if (c.ransomwareSublimitPct === 50) rwFactor *= 0.95;
  if (c.ransomwareCoinsurancePct === 50) rwFactor *= 0.9;
  if (rwFactor !== 1) ws.add('Core Premium', `Ransomware sublimit ${c.ransomwareSublimitPct}% / coinsurance ${c.ransomwareCoinsurancePct}%`, rwFactor);
  const waitFactor = c.biWaitingHours >= 24 ? 0.97 : c.biWaitingHours <= 8 ? 1.03 : 1;
  if (waitFactor !== 1) ws.add('Core Premium', `BI waiting period ${c.biWaitingHours} hours`, waitFactor);
  const coreAdj = core * rwFactor * waitFactor;

  const lines = [
    { coverage: 'Third Party Liability (Privacy, Network Security, Regulatory)', premium: coreAdj * 0.4 },
    { coverage: 'First Party Breach Response', premium: coreAdj * 0.25 },
    { coverage: 'Business Interruption & Data Restoration', premium: coreAdj * 0.2 },
    { coverage: 'Cyber Extortion / Ransomware', premium: coreAdj * 0.15 },
  ];
  if (!c.regulatoryFines) {
    lines[0].premium *= 0.92;
    ws.add('Optional Coverages', 'Regulatory fines & penalties excluded', 0.92);
  }
  const seRate: Record<number, number> = { 0: 0, 100_000: 0.03, 250_000: 0.05, 500_000: 0.08, 1_000_000: 0.12 };
  const addOn = (label: string, pct: number) => {
    const p = coreAdj * pct;
    ws.add('Optional Coverages', label, `${(pct * 100).toFixed(1)}% of core`, p);
    lines.push({ coverage: label, premium: p });
  };
  if (c.socialEngineeringLimit > 0) addOn(`Social Engineering Fraud ($${c.socialEngineeringLimit.toLocaleString()})`, seRate[c.socialEngineeringLimit] ?? 0.05);
  if (c.dependentBI) addOn('Dependent Business Interruption', 0.05);
  if (c.mediaLiability) addOn('Media Liability', 0.03);
  if (c.pciFines) addOn('PCI Fines & Assessments', 0.04);

  const technical = lines.reduce((s, l) => s + l.premium, 0);
  ws.add('Premium', 'Technical premium', undefined, technical);
  const sm = scheduleModFactor(risk.scheduleMod);
  ws.add('Premium', `Schedule rating ${risk.scheduleMod >= 0 ? '+' : ''}${risk.scheduleMod}%${risk.scheduleModReason ? ` (${risk.scheduleModReason})` : ''}`, sm);
  const scaled = lines.map((l) => ({ ...l, premium: l.premium * sm }));
  return finalize({ ws, lines: scaled, technicalPremium: technical, minimumPremium: PRODUCTS.CYBER.minimumPremium, policyFee: PRODUCTS.CYBER.policyFee, state: account.state });
}

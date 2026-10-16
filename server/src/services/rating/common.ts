import type { Loss, PremiumLine, PricingResult, WorksheetLine } from '../../types.js';

export const round = (n: number) => Math.round(n);
export const round4 = (n: number) => Math.round(n * 10000) / 10000;

export class Worksheet {
  lines: WorksheetLine[] = [];
  add(section: string, label: string, factor?: number | string, amount?: number, basis?: string) {
    this.lines.push({ section, label, factor: typeof factor === 'number' ? round4(factor) : factor, amount: amount === undefined ? undefined : round(amount), basis });
  }
}

/** Look up the factor for the highest band whose threshold is <= value. */
export function band<T>(value: number, bands: [number, T][]): T {
  let out = bands[0][1];
  for (const [threshold, v] of bands) if (value >= threshold) out = v;
  return out;
}

export function lossExperience(losses: Loss[], asOf: string): { factor: number; count: number; incurred: number; largeLoss: boolean } {
  const cutoff = new Date(asOf);
  cutoff.setFullYear(cutoff.getFullYear() - 5);
  const recent = losses.filter((l) => new Date(l.date) >= cutoff);
  const incurred = recent.reduce((s, l) => s + (Number(l.paid) || 0) + (Number(l.reserved) || 0), 0);
  const count = recent.length;
  const largeLoss = recent.some((l) => (Number(l.paid) || 0) + (Number(l.reserved) || 0) > 100_000);
  let factor = count === 0 ? 0.95 : count === 1 ? 1.0 : count === 2 ? 1.1 : 1.25;
  if (largeLoss) factor *= 1.1;
  return { factor, count, incurred, largeLoss };
}

export const STATE_TAXES: Record<string, { label: string; rate: number }[]> = {
  KY: [{ label: 'KY Municipal Premium Tax', rate: 0.018 }, { label: 'KY Surcharge', rate: 0.018 }],
  WV: [{ label: 'WV Policy Surcharge', rate: 0.0055 }],
  NJ: [{ label: 'NJ PLIGA Surcharge', rate: 0.009 }],
  MN: [{ label: 'MN Fire Safety Surcharge', rate: 0.0065 }],
  FL: [{ label: 'FL Insurance Guaranty Assessment', rate: 0.007 }],
};

export function scheduleModFactor(pct: number): number {
  const p = Math.max(-25, Math.min(25, Number(pct) || 0));
  return 1 + p / 100;
}

export function finalize(args: {
  ws: Worksheet;
  lines: PremiumLine[];
  technicalPremium: number;
  minimumPremium: number;
  policyFee: number;
  state: string;
}): PricingResult {
  const { ws, minimumPremium, policyFee, state } = args;
  let lines = args.lines.map((l) => ({ ...l, premium: round(l.premium) })).filter((l) => l.premium !== 0);
  let premium = lines.reduce((s, l) => s + l.premium, 0);
  let minimumPremiumApplied = false;
  if (premium < minimumPremium) {
    ws.add('Premium', 'Minimum premium adjustment', undefined, minimumPremium - premium);
    lines.push({ coverage: 'Minimum Premium Adjustment', premium: minimumPremium - premium });
    premium = minimumPremium;
    minimumPremiumApplied = true;
  }
  const taxesAndFees = [{ label: 'Policy Fee', amount: policyFee }];
  for (const t of STATE_TAXES[state] ?? []) taxesAndFees.push({ label: t.label, amount: round(premium * t.rate) });
  const totalCost = premium + taxesAndFees.reduce((s, t) => s + t.amount, 0);
  ws.add('Premium', 'Total premium', undefined, premium);
  for (const t of taxesAndFees) ws.add('Taxes & Fees', t.label, undefined, t.amount);
  ws.add('Total', 'Total cost', undefined, totalCost);
  return {
    ratedAt: new Date().toISOString(),
    lines,
    worksheet: ws.lines,
    technicalPremium: round(args.technicalPremium),
    premium,
    taxesAndFees,
    totalCost,
    minimumPremiumApplied,
  };
}

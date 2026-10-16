import { PRODUCTS } from '../../products/index.js';
import { CONSTRUCTION_CLASSES, OCCUPANCIES } from '../../products/property.js';
import type { Account, Building, PricingResult, PropertyRisk } from '../../types.js';
import { locationHazard } from '../scan/crp.js';
import { Worksheet, band, finalize, lossExperience, scheduleModFactor } from './common.js';

export function protectionClassFactor(pc: number): number {
  return band(pc, [[1, 0.85], [4, 1.0], [7, 1.2], [9, 1.5], [10, 1.9]]);
}
export function sprinklerFactor(pct: number): number {
  return pct >= 100 ? 0.7 : pct >= 50 ? 0.85 : 1.0;
}
export function ageFactor(yearBuilt: number): number {
  return band(yearBuilt, [[0, 1.25], [1950, 1.1], [1980, 1.0], [2000, 0.95]]);
}
export const COL_FACTOR = { Basic: 0.8, Broad: 0.9, Special: 1.0 } as const;
export const AOP_DED_FACTOR: Record<number, number> = { 1_000: 1.05, 2_500: 1.0, 5_000: 0.95, 10_000: 0.9, 25_000: 0.82, 50_000: 0.75, 100_000: 0.68 };
export const COINS_FACTOR: Record<number, number> = { 80: 1.0, 90: 0.95, 100: 0.9 };
export const WHD_FACTOR: Record<number, number> = { 0: 1.0, 1: 0.95, 2: 0.85, 5: 0.7 };

export const tiv = (b: Building) => (Number(b.buildingValue) || 0) + (Number(b.bppValue) || 0) + (Number(b.biValue) || 0);

export function rateProperty(risk: PropertyRisk, account: Account, effectiveDate: string): PricingResult {
  const ws = new Worksheet();
  const c = risk.coverages;
  const totals = { building: 0, bpp: 0, bi: 0, wind: 0, quake: 0, eb: 0 };
  const policyFactor = COL_FACTOR[c.causeOfLoss] * (c.valuation === 'ACV' ? 0.9 : 1) * (COINS_FACTOR[c.coinsurance] ?? 1) * (AOP_DED_FACTOR[c.aopDeductible] ?? 1);
  ws.add('Policy Factors', `Cause of loss - ${c.causeOfLoss}`, COL_FACTOR[c.causeOfLoss]);
  ws.add('Policy Factors', `Valuation - ${c.valuation}`, c.valuation === 'ACV' ? 0.9 : 1);
  ws.add('Policy Factors', `Coinsurance ${c.coinsurance}%`, COINS_FACTOR[c.coinsurance] ?? 1);
  ws.add('Policy Factors', `AOP deductible $${c.aopDeductible.toLocaleString()}`, AOP_DED_FACTOR[c.aopDeductible] ?? 1);

  for (const b of risk.buildings) {
    const loc = risk.locations.find((l) => l.id === b.locationId);
    if (!loc) continue;
    const S = `Loc ${loc.number} / Bldg ${b.number}`;
    const cc = CONSTRUCTION_CLASSES[b.constructionClass] ?? CONSTRUCTION_CLASSES[1];
    const occ = OCCUPANCIES[b.occupancy] ?? { factor: 1 };
    const pcf = protectionClassFactor(loc.protectionClass);
    const spr = sprinklerFactor(b.sprinklerPct);
    const age = ageFactor(b.yearBuilt);
    const alarm = b.alarm === 'Central Station' ? 0.95 : b.alarm === 'Local' ? 0.98 : 1;
    const vacancy = b.occupiedPct < 50 ? 1.25 : 1;
    ws.add(S, `Base rate per $100 - ${cc.name}`, cc.baseRate);
    ws.add(S, `Protection class ${loc.protectionClass}`, pcf);
    ws.add(S, `Occupancy - ${b.occupancy}`, occ.factor);
    ws.add(S, `Sprinklered ${b.sprinklerPct}%`, spr);
    ws.add(S, `Age of construction (${b.yearBuilt})`, age);
    if (alarm !== 1) ws.add(S, `Alarm - ${b.alarm}`, alarm);
    if (vacancy !== 1) ws.add(S, `Vacancy / low occupancy (${b.occupiedPct}% occupied)`, vacancy);
    const rate = cc.baseRate * pcf * occ.factor * spr * age * alarm * vacancy * policyFactor;
    ws.add(S, 'Final rate per $100', rate);
    const bp = (b.buildingValue / 100) * rate;
    const pp = (b.bppValue / 100) * rate * 1.1;
    const bi = (b.biValue / 100) * rate * 0.6;
    ws.add(S, `Building premium ($${Number(b.buildingValue).toLocaleString()})`, undefined, bp);
    ws.add(S, `BPP premium ($${Number(b.bppValue).toLocaleString()}, contents x1.10)`, undefined, pp);
    if (b.biValue) ws.add(S, `Business income premium ($${Number(b.biValue).toLocaleString()}, x0.60)`, undefined, bi);
    totals.building += bp;
    totals.bpp += pp;
    totals.bi += bi;

    // Catastrophe loads from the location hazard profile.
    const h = locationHazard(loc);
    const t = tiv(b);
    const windRate = (h.windTier === 1 ? 0.12 : h.windTier === 2 ? 0.04 : 0) + (h.hail === 'High' ? 0.015 : 0);
    if (windRate > 0) {
      const whd = WHD_FACTOR[c.windHailDeductiblePct] ?? 1;
      const w = (t / 100) * windRate * whd;
      ws.add(S, `Wind/hail CAT load (tier ${h.windTier}, hail ${h.hail}, ${c.windHailDeductiblePct}% ded)`, windRate * whd, w);
      totals.wind += w;
    }
    if (h.wildfire !== 'Low') {
      const wf = (t / 100) * (h.wildfire === 'High' ? 0.03 : 0.01);
      ws.add(S, `Wildfire load (${h.wildfire})`, undefined, wf);
      totals.building += wf;
    }
    if (c.earthquake) {
      const eqRate = h.quake === 'High' ? 0.15 : h.quake === 'Moderate' ? 0.05 : 0.01;
      const eq = ((b.buildingValue + b.bppValue) / 100) * eqRate;
      ws.add(S, `Earthquake (${h.quake} hazard)`, eqRate, eq);
      totals.quake += eq;
    }
    if (c.equipmentBreakdown) totals.eb += Math.max(250, (t / 100) * 0.004);
  }

  const le = lossExperience(risk.losses, effectiveDate);
  ws.add('Experience', `Loss experience (${le.count} losses, $${le.incurred.toLocaleString()} incurred${le.largeLoss ? ', large loss' : ''})`, le.factor);
  const sm = scheduleModFactor(risk.scheduleMod);
  ws.add('Experience', `Schedule rating ${risk.scheduleMod >= 0 ? '+' : ''}${risk.scheduleMod}%${risk.scheduleModReason ? ` (${risk.scheduleModReason})` : ''}`, sm);
  const mod = le.factor * sm;

  const lines = [
    { coverage: 'Building', premium: totals.building * mod },
    { coverage: 'Business Personal Property', premium: totals.bpp * mod },
    { coverage: 'Business Income & Extra Expense', premium: totals.bi * mod },
    { coverage: 'Windstorm / Hail (CAT)', premium: totals.wind * mod },
    { coverage: 'Earthquake', premium: totals.quake },
    { coverage: 'Equipment Breakdown', premium: totals.eb },
  ];
  const technical = (totals.building + totals.bpp + totals.bi + totals.wind) * le.factor + totals.quake + totals.eb;
  if (c.terrorism) {
    const tr = lines.reduce((s, l) => s + l.premium, 0) * 0.01;
    ws.add('Optional Coverages', 'Certified acts of terrorism (TRIA)', '1% of premium', tr);
    lines.push({ coverage: 'Terrorism (TRIA)', premium: tr });
  }
  if (c.equipmentBreakdown) ws.add('Optional Coverages', 'Equipment breakdown ($0.004 per $100 TIV, min $250/bldg)', undefined, totals.eb);
  return finalize({ ws, lines, technicalPremium: technical, minimumPremium: PRODUCTS.PROPERTY.minimumPremium, policyFee: PRODUCTS.PROPERTY.policyFee, state: account.state });
}

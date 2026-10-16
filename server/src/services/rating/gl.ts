import { GL_LIMIT_OPTIONS, glClass } from '../../products/gl.js';
import { PRODUCTS } from '../../products/index.js';
import type { Account, GLRisk, PricingResult } from '../../types.js';
import { Worksheet, finalize, lossExperience, scheduleModFactor } from './common.js';

export const GL_TERRITORY: Record<string, number> = { NY: 1.35, CA: 1.25, FL: 1.2, LA: 1.2, IL: 1.15, NJ: 1.15, TX: 1.05, GA: 1.05, PA: 1.05 };
export const GL_DED_FACTOR: Record<number, number> = { 0: 1.0, 1_000: 0.97, 2_500: 0.94, 5_000: 0.9, 10_000: 0.85, 25_000: 0.78 };

export function rateGL(risk: GLRisk, account: Account, effectiveDate: string): PricingResult {
  const ws = new Worksheet();
  const c = risk.coverages;
  const lim = GL_LIMIT_OPTIONS[c.limitOption] ?? GL_LIMIT_OPTIONS['1M/2M'];
  const ded = GL_DED_FACTOR[c.deductible] ?? 1;
  ws.add('Policy Factors', `Limits ${c.limitOption} (ILF)`, lim.ilf);
  ws.add('Policy Factors', `BI/PD deductible $${c.deductible.toLocaleString()}`, ded);
  let premOps = 0;
  let products = 0;
  for (const e of risk.exposures) {
    const cls = glClass(e.classCode);
    const loc = risk.locations.find((l) => l.id === e.locationId);
    if (!cls || !loc) continue;
    const S = `Loc ${loc.number} / Class ${cls.code}`;
    const terr = GL_TERRITORY[loc.state] ?? 1;
    const units = (Number(e.exposure) || 0) / 1000;
    const unitLabel = cls.basis === 'Area' ? 'per 1,000 sq ft' : `per $1,000 ${cls.basis.toLowerCase()}`;
    ws.add(S, `${cls.description} - exposure ${Number(e.exposure).toLocaleString()} (${cls.basis})`, undefined, undefined, unitLabel);
    ws.add(S, `Territory factor (${loc.state})`, terr);
    const po = units * cls.premOpsRate * terr * lim.ilf * ded;
    ws.add(S, `Premises/operations @ ${cls.premOpsRate} ${unitLabel}`, cls.premOpsRate, po);
    premOps += po;
    if (cls.productsRate > 0) {
      const pr = units * cls.productsRate * terr * lim.ilf * ded;
      ws.add(S, `Products/completed operations @ ${cls.productsRate} ${unitLabel}`, cls.productsRate, pr);
      products += pr;
    }
  }
  if (c.medPay === 0) {
    premOps *= 0.98;
    ws.add('Policy Factors', 'Medical payments excluded', 0.98);
  }
  const le = lossExperience(risk.losses, effectiveDate);
  ws.add('Experience', `Loss experience (${le.count} claims, $${le.incurred.toLocaleString()} incurred${le.largeLoss ? ', large loss' : ''})`, le.factor);
  const sm = scheduleModFactor(risk.scheduleMod);
  ws.add('Experience', `Schedule rating ${risk.scheduleMod >= 0 ? '+' : ''}${risk.scheduleMod}%${risk.scheduleModReason ? ` (${risk.scheduleModReason})` : ''}`, sm);
  const mod = le.factor * sm;

  const lines = [
    { coverage: 'Premises / Operations', premium: premOps * mod },
    { coverage: 'Products / Completed Operations', premium: products * mod },
  ];
  const flat = (label: string, amount: number) => {
    ws.add('Optional Coverages', label, 'flat', amount);
    lines.push({ coverage: label, premium: amount });
  };
  if (c.hiredNonOwnedAuto) flat('Hired & Non-Owned Auto Liability', 350);
  if (c.blanketAdditionalInsured) flat('Blanket Additional Insured', 250);
  if (c.waiverOfSubrogation) flat('Blanket Waiver of Subrogation', 150);
  if (c.terrorism) {
    const tr = (premOps + products) * mod * 0.01;
    ws.add('Optional Coverages', 'Certified acts of terrorism (TRIA)', '1% of premium', tr);
    lines.push({ coverage: 'Terrorism (TRIA)', premium: tr });
  }
  const technical = (premOps + products) * le.factor;
  return finalize({ ws, lines, technicalPremium: technical, minimumPremium: PRODUCTS.GL.minimumPremium, policyFee: PRODUCTS.GL.policyFee, state: account.state });
}

import type { Account, CrpScanResult, PricingResult, RiskData } from '../../types.js';
import { rateCyber } from './cyber.js';
import { rateGL } from './gl.js';
import { rateProperty } from './property.js';

export function rate(risk: RiskData, account: Account, scan: CrpScanResult | null, effectiveDate: string): PricingResult {
  switch (risk.product) {
    case 'CYBER':
      return rateCyber(risk, account, scan, effectiveDate);
    case 'PROPERTY':
      return rateProperty(risk, account, effectiveDate);
    case 'GL':
      return rateGL(risk, account, effectiveDate);
  }
}

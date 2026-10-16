// Data validation run before rating (PolicyCenter "Validation Results").

import { CYBER_QUESTIONS } from '../products/cyber.js';
import { glClass } from '../products/gl.js';
import type { RiskData } from '../types.js';

export interface ValidationMessage {
  level: 'error' | 'warning';
  step: string;
  message: string;
}

export function validateRisk(risk: RiskData): ValidationMessage[] {
  const out: ValidationMessage[] = [];
  const err = (step: string, message: string) => out.push({ level: 'error', step, message });
  const warn = (step: string, message: string) => out.push({ level: 'warning', step, message });

  if (Math.abs(Number(risk.scheduleMod) || 0) > 25) err('pricing', 'Schedule rating must be between -25% and +25%.');
  if (risk.scheduleMod && !risk.scheduleModReason) warn('pricing', 'Schedule rating applied without a documented reason.');

  if (risk.product === 'CYBER') {
    if (!(risk.annualRevenue > 0)) err('exposure', 'Annual revenue is required.');
    if (!risk.domains.length) warn('exposure', 'No domains entered; CRP scan cannot run.');
    for (const q of CYBER_QUESTIONS) if (q.required && !risk.answers[q.code]) err('qualification', `Answer required: ${q.text}`);
  }
  if (risk.product === 'PROPERTY') {
    if (!risk.locations.length) err('locations', 'At least one location is required.');
    for (const l of risk.locations) {
      if (!l.address1 || !l.city || !l.state || !l.zip) err('locations', `Location ${l.number}: complete address is required.`);
      if (!(l.protectionClass >= 1 && l.protectionClass <= 10)) err('locations', `Location ${l.number}: protection class must be 1-10.`);
    }
    if (!risk.buildings.length) err('buildings', 'At least one building is required.');
    for (const b of risk.buildings) {
      if (!risk.locations.some((l) => l.id === b.locationId)) err('buildings', `Building ${b.number}: location not found.`);
      if (!(b.buildingValue > 0) && !(b.bppValue > 0)) err('buildings', `Building ${b.number}: building or BPP limit is required.`);
      if (!b.yearBuilt || b.yearBuilt < 1800) err('buildings', `Building ${b.number}: valid year built is required.`);
      if (!b.occupancy) err('buildings', `Building ${b.number}: occupancy is required.`);
    }
  }
  if (risk.product === 'GL') {
    if (!risk.locations.length) err('locations', 'At least one location is required.');
    for (const l of risk.locations) if (!l.state) err('locations', `Location ${l.number}: state is required.`);
    if (!risk.exposures.length) err('exposures', 'At least one class code exposure is required.');
    for (const e of risk.exposures) {
      if (!glClass(e.classCode)) err('exposures', `Unknown class code ${e.classCode}.`);
      if (!(e.exposure > 0)) err('exposures', `Class ${e.classCode}: exposure amount is required.`);
      if (!risk.locations.some((l) => l.id === e.locationId)) err('exposures', `Class ${e.classCode}: location not found.`);
    }
  }
  return out;
}

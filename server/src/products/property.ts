import type { PropertyRisk } from '../types.js';

export const CONSTRUCTION_CLASSES: Record<number, { name: string; baseRate: number }> = {
  1: { name: 'Frame', baseRate: 0.45 },
  2: { name: 'Joisted Masonry', baseRate: 0.32 },
  3: { name: 'Non-Combustible', baseRate: 0.24 },
  4: { name: 'Masonry Non-Combustible', baseRate: 0.2 },
  5: { name: 'Modified Fire Resistive', baseRate: 0.16 },
  6: { name: 'Fire Resistive', baseRate: 0.14 },
};

export const OCCUPANCIES: Record<string, { factor: number; hazard: 'Low' | 'Moderate' | 'High' }> = {
  Office: { factor: 0.85, hazard: 'Low' },
  'Retail Store': { factor: 1.0, hazard: 'Moderate' },
  Warehouse: { factor: 1.1, hazard: 'Moderate' },
  'Light Manufacturing': { factor: 1.2, hazard: 'Moderate' },
  'Heavy Manufacturing': { factor: 1.45, hazard: 'High' },
  Restaurant: { factor: 1.6, hazard: 'High' },
  'Apartment Building': { factor: 1.05, hazard: 'Moderate' },
  'Hotel / Motel': { factor: 1.15, hazard: 'Moderate' },
  'Medical Office': { factor: 0.95, hazard: 'Low' },
  'Woodworking / Sawmill': { factor: 1.9, hazard: 'High' },
};

export const AOP_DEDUCTIBLES = [1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000];
export const WIND_HAIL_DEDUCTIBLES = [0, 1, 2, 5];

export const PROPERTY_FORMS = [
  { number: 'CP 00 10 10 12', title: 'Building and Personal Property Coverage Form' },
  { number: 'CP 00 30 10 12', title: 'Business Income (and Extra Expense) Coverage Form' },
  { number: 'CP 00 90 07 88', title: 'Commercial Property Conditions' },
  { number: 'CP 10 10 10 12', title: 'Causes of Loss - Basic Form' },
  { number: 'CP 10 20 10 12', title: 'Causes of Loss - Broad Form' },
  { number: 'CP 10 30 09 17', title: 'Causes of Loss - Special Form' },
  { number: 'CP 10 40 10 12', title: 'Earthquake and Volcanic Eruption Endorsement' },
  { number: 'CP 03 21 10 12', title: 'Windstorm or Hail Percentage Deductible' },
  { number: 'EB 00 20 01 25', title: 'Equipment Breakdown Coverage Endorsement' },
  { number: 'CP 01 40 07 06', title: 'Exclusion of Loss Due to Virus or Bacteria' },
];

export function defaultPropertyRisk(addr?: { address1: string; city: string; state: string; zip: string }): PropertyRisk {
  const loc = { id: 'L1', number: 1, address1: addr?.address1 ?? '', city: addr?.city ?? '', state: addr?.state ?? '', zip: addr?.zip ?? '', protectionClass: 4 };
  return {
    product: 'PROPERTY',
    locations: [loc],
    buildings: [],
    coverages: {
      causeOfLoss: 'Special',
      valuation: 'RC',
      coinsurance: 80,
      aopDeductible: 5_000,
      windHailDeductiblePct: 0,
      earthquake: false,
      equipmentBreakdown: true,
      terrorism: false,
    },
    scheduleMod: 0,
    scheduleModReason: '',
    losses: [],
    noLossesCertified: false,
  };
}

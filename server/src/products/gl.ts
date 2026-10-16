import type { GLRisk } from '../types.js';

export interface GLClass {
  code: string;
  description: string;
  basis: 'Sales' | 'Payroll' | 'Area';
  /** Premises/operations rate per $1,000 (sales/payroll) or per 1,000 sq ft (area). */
  premOpsRate: number;
  /** Products/completed-operations rate on the same basis. */
  productsRate: number;
  hazard: 'Low' | 'Moderate' | 'High' | 'Prohibited';
}

export const GL_CLASSES: GLClass[] = [
  { code: '10010', description: 'Retail Stores - General Merchandise', basis: 'Sales', premOpsRate: 0.48, productsRate: 0.14, hazard: 'Low' },
  { code: '16900', description: 'Restaurants - without alcohol', basis: 'Sales', premOpsRate: 1.05, productsRate: 0.3, hazard: 'Moderate' },
  { code: '16910', description: 'Restaurants - alcohol sales under 30%', basis: 'Sales', premOpsRate: 1.45, productsRate: 0.4, hazard: 'Moderate' },
  { code: '41650', description: 'Offices - Professional', basis: 'Area', premOpsRate: 41.2, productsRate: 0, hazard: 'Low' },
  { code: '41677', description: 'Consultants - Management / Engineering', basis: 'Sales', premOpsRate: 0.62, productsRate: 0.08, hazard: 'Low' },
  { code: '43551', description: 'Software Development Services', basis: 'Sales', premOpsRate: 0.21, productsRate: 0.07, hazard: 'Low' },
  { code: '45191', description: 'Hotels and Motels - no pools', basis: 'Sales', premOpsRate: 1.2, productsRate: 0.1, hazard: 'Moderate' },
  { code: '49451', description: 'Wholesale Distributors - Non-food', basis: 'Sales', premOpsRate: 0.32, productsRate: 0.22, hazard: 'Low' },
  { code: '51896', description: 'Machinery Manufacturing', basis: 'Sales', premOpsRate: 0.6, productsRate: 0.75, hazard: 'Moderate' },
  { code: '61217', description: "Buildings - Lessor's Risk Only", basis: 'Area', premOpsRate: 38.5, productsRate: 0, hazard: 'Low' },
  { code: '68500', description: 'Warehouses - Private', basis: 'Area', premOpsRate: 22.4, productsRate: 0, hazard: 'Low' },
  { code: '91111', description: 'Air Conditioning Systems - Installation', basis: 'Payroll', premOpsRate: 5.9, productsRate: 2.1, hazard: 'Moderate' },
  { code: '91340', description: 'Carpentry - Interior', basis: 'Payroll', premOpsRate: 7.6, productsRate: 2.6, hazard: 'Moderate' },
  { code: '92215', description: 'Driveway, Parking Area or Sidewalk - Paving', basis: 'Payroll', premOpsRate: 8.9, productsRate: 2.8, hazard: 'Moderate' },
  { code: '98483', description: 'Plumbing - Commercial and Industrial', basis: 'Payroll', premOpsRate: 9.4, productsRate: 4.1, hazard: 'Moderate' },
  { code: '98677', description: 'Roofing - Commercial', basis: 'Payroll', premOpsRate: 21.5, productsRate: 9.5, hazard: 'High' },
  { code: '99999', description: 'Fireworks / Explosives Manufacturing', basis: 'Sales', premOpsRate: 0, productsRate: 0, hazard: 'Prohibited' },
];

export function glClass(code: string): GLClass | undefined {
  return GL_CLASSES.find((c) => c.code === code);
}

export const GL_LIMIT_OPTIONS: Record<string, { occurrence: number; aggregate: number; productsAggregate: number; ilf: number }> = {
  '500K/1M': { occurrence: 500_000, aggregate: 1_000_000, productsAggregate: 1_000_000, ilf: 0.84 },
  '1M/2M': { occurrence: 1_000_000, aggregate: 2_000_000, productsAggregate: 2_000_000, ilf: 1.0 },
  '1M/3M': { occurrence: 1_000_000, aggregate: 3_000_000, productsAggregate: 3_000_000, ilf: 1.06 },
  '2M/4M': { occurrence: 2_000_000, aggregate: 4_000_000, productsAggregate: 4_000_000, ilf: 1.32 },
};

export const GL_DEDUCTIBLES = [0, 1_000, 2_500, 5_000, 10_000, 25_000];

export const GL_FORMS = [
  { number: 'CG 00 01 04 13', title: 'Commercial General Liability Coverage Form (Occurrence)' },
  { number: 'CG DS 01 10 01', title: 'Commercial General Liability Declarations' },
  { number: 'CG 03 00 01 96', title: 'Deductible Liability Insurance' },
  { number: 'CG 20 10 12 19', title: 'Additional Insured - Owners, Lessees or Contractors (Blanket)' },
  { number: 'CG 24 04 12 19', title: 'Waiver of Transfer of Rights of Recovery Against Others' },
  { number: 'CG 21 06 05 14', title: 'Exclusion - Access or Disclosure of Confidential Information' },
  { number: 'CG 21 47 12 07', title: 'Employment-Related Practices Exclusion' },
  { number: 'CG 21 67 12 04', title: 'Fungi or Bacteria Exclusion' },
  { number: 'CG 21 70 01 15', title: 'Cap on Losses From Certified Acts of Terrorism' },
];

export function defaultGLRisk(addr?: { address1: string; city: string; state: string; zip: string }): GLRisk {
  return {
    product: 'GL',
    locations: [{ id: 'L1', number: 1, address1: addr?.address1 ?? '', city: addr?.city ?? '', state: addr?.state ?? '', zip: addr?.zip ?? '', protectionClass: 4 }],
    exposures: [],
    coverages: {
      limitOption: '1M/2M',
      personalAdvInjury: 1_000_000,
      damageToRented: 100_000,
      medPay: 5_000,
      deductible: 0,
      hiredNonOwnedAuto: false,
      blanketAdditionalInsured: true,
      waiverOfSubrogation: false,
      terrorism: false,
    },
    scheduleMod: 0,
    scheduleModReason: '',
    losses: [],
    noLossesCertified: false,
  };
}

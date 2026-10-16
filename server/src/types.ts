// Core domain types for the pre-bind workbench.
// Terminology follows the PolicyCenter model: Account -> Submission (job) -> Version (policy period).

export type Product = 'CYBER' | 'PROPERTY' | 'GL';

export type SubmissionStatus =
  | 'INTAKE'
  | 'CLEARANCE_REFERRAL'
  | 'DRAFT'
  | 'RATED'
  | 'QUOTED'
  | 'DECLINED'
  | 'WITHDRAWN';

export const STATUS_LABELS: Record<SubmissionStatus, string> = {
  INTAKE: 'Intake',
  CLEARANCE_REFERRAL: 'Clearance Referral',
  DRAFT: 'Draft',
  RATED: 'Rated',
  QUOTED: 'Quoted',
  DECLINED: 'Declined',
  WITHDRAWN: 'Withdrawn',
};

export type CheckOutcome = 'PASS' | 'REFER' | 'DECLINE';

export type BlockingPoint = 'Quote' | 'Bind' | 'Informational';

export type IssueStatus = 'Open' | 'Approved' | 'Rejected';

export interface User {
  id: number;
  username: string;
  name: string;
  role: 'Intake Specialist' | 'Underwriter' | 'Senior Underwriter' | 'Underwriting Manager' | 'Administrator';
  authorityLevel: number;
  email: string;
}

export interface Producer {
  id: number;
  code: string;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  licensedStates: string[];
  commissionPct: number;
  active: boolean;
}

export interface Account {
  id: number;
  accountNumber: string;
  name: string;
  dba: string;
  fein: string;
  entityType: string;
  naics: string;
  industry: string;
  address1: string;
  city: string;
  state: string;
  zip: string;
  website: string;
  yearsInBusiness: number;
  annualRevenue: number;
  employeeCount: number;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  status: 'Active' | 'Pending';
  createdAt: string;
}

export interface Loss {
  date: string;
  type: string;
  description: string;
  paid: number;
  reserved: number;
  status: 'Open' | 'Closed';
}

interface CommonRisk {
  /** Underwriter schedule rating, percent (-25..+25). */
  scheduleMod: number;
  scheduleModReason: string;
  losses: Loss[];
  noLossesCertified: boolean;
}

export interface CyberCoverages {
  aggregateLimit: number;
  retention: number;
  ransomwareSublimitPct: 100 | 50;
  ransomwareCoinsurancePct: 0 | 50;
  socialEngineeringLimit: number;
  dependentBI: boolean;
  mediaLiability: boolean;
  regulatoryFines: boolean;
  pciFines: boolean;
  biWaitingHours: number;
}

export interface CyberRisk extends CommonRisk {
  product: 'CYBER';
  annualRevenue: number;
  employeeCount: number;
  piiRecords: number;
  phiRecords: number;
  pciRecords: number;
  domains: string[];
  answers: Record<string, string>;
  coverages: CyberCoverages;
}

export interface Location {
  id: string;
  number: number;
  address1: string;
  city: string;
  state: string;
  zip: string;
  protectionClass: number;
}

export interface Building {
  id: string;
  locationId: string;
  number: number;
  description: string;
  constructionClass: number;
  occupancy: string;
  yearBuilt: number;
  roofYear: number;
  stories: number;
  squareFeet: number;
  sprinklerPct: number;
  alarm: 'None' | 'Local' | 'Central Station';
  occupiedPct: number;
  buildingValue: number;
  bppValue: number;
  biValue: number;
}

export interface PropertyCoverages {
  causeOfLoss: 'Basic' | 'Broad' | 'Special';
  valuation: 'RC' | 'ACV';
  coinsurance: number;
  aopDeductible: number;
  windHailDeductiblePct: number;
  earthquake: boolean;
  equipmentBreakdown: boolean;
  terrorism: boolean;
}

export interface PropertyRisk extends CommonRisk {
  product: 'PROPERTY';
  locations: Location[];
  buildings: Building[];
  coverages: PropertyCoverages;
}

export interface GLExposure {
  id: string;
  locationId: string;
  classCode: string;
  exposure: number;
}

export interface GLCoverages {
  limitOption: string;
  personalAdvInjury: number;
  damageToRented: number;
  medPay: number;
  deductible: number;
  hiredNonOwnedAuto: boolean;
  blanketAdditionalInsured: boolean;
  waiverOfSubrogation: boolean;
  terrorism: boolean;
}

export interface GLRisk extends CommonRisk {
  product: 'GL';
  locations: Location[];
  exposures: GLExposure[];
  coverages: GLCoverages;
}

export type RiskData = CyberRisk | PropertyRisk | GLRisk;

export interface WorksheetLine {
  section: string;
  label: string;
  basis?: string;
  factor?: number | string;
  amount?: number;
}

export interface PremiumLine {
  coverage: string;
  premium: number;
}

export interface PricingResult {
  ratedAt: string;
  lines: PremiumLine[];
  worksheet: WorksheetLine[];
  /** Technical premium before schedule rating. */
  technicalPremium: number;
  /** Premium after schedule rating and minimums. */
  premium: number;
  taxesAndFees: { label: string; amount: number }[];
  totalCost: number;
  minimumPremiumApplied: boolean;
}

export interface ClearanceCheck {
  code: string;
  name: string;
  outcome: CheckOutcome;
  message: string;
  details?: string[];
}

export interface ClearanceResult {
  runAt: string;
  outcome: CheckOutcome;
  checks: ClearanceCheck[];
  override?: { by: string; reason: string; at: string };
}

export interface ScanFinding {
  category: string;
  title: string;
  severity: 'Critical' | 'High' | 'Medium' | 'Low' | 'Info';
  detail: string;
  /** Points deducted from the posture score. */
  impact: number;
  code: string;
}

export interface ScanSection {
  name: string;
  score: number;
  grade: string;
  summary: Record<string, string | number | boolean>;
  findings: ScanFinding[];
}

export interface CrpScanResult {
  runAt: string;
  provider: string;
  product: Product;
  compositeScore: number;
  grade: string;
  sections: ScanSection[];
}

export interface UWIssue {
  id: number;
  submissionId: number;
  versionId: number;
  code: string;
  shortDescription: string;
  longDescription: string;
  blockingPoint: BlockingPoint;
  requiredAuthority: number;
  value: string;
  status: IssueStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  subjectivity: string | null;
}

export interface Submission {
  id: number;
  jobNumber: string;
  accountId: number;
  producerId: number;
  product: Product;
  status: SubmissionStatus;
  underwriterId: number | null;
  effectiveDate: string;
  expirationDate: string;
  receivedDate: string;
  source: string;
  priority: 'Low' | 'Normal' | 'High' | 'Rush';
  description: string;
  clearance: ClearanceResult | null;
  scan: CrpScanResult | null;
  declineReason: string | null;
  selectedVersionId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Version {
  id: number;
  submissionId: number;
  versionNo: number;
  name: string;
  risk: RiskData;
  pricing: PricingResult | null;
  status: 'Draft' | 'Rated' | 'Quoted';
  createdAt: string;
}

/** Frozen copy of everything printed on a quote proposal. */
export interface QuoteSnapshot {
  quoteNumber: string;
  issuedAt: string;
  validUntil: string;
  product: RiskData['product'];
  productName: string;
  jobNumber: string;
  effectiveDate: string;
  expirationDate: string;
  account: Account;
  producer: Producer;
  underwriter: { name: string; email: string } | null;
  versionName: string;
  risk: RiskData;
  pricing: PricingResult;
  scan: { compositeScore: number; grade: string; provider: string } | null;
  forms: { number: string; title: string }[];
  subjectivities: string[];
}

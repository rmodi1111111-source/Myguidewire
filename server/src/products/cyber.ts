import type { CyberRisk } from '../types.js';

export interface Question {
  code: string;
  section: string;
  text: string;
  type: 'yesno' | 'select';
  options?: string[];
  /** Rating modifier applied by answer, as a decimal debit (+) or credit (-). */
  rating?: Record<string, number>;
  required: boolean;
}

/** Cyber qualification / security controls questionnaire. */
export const CYBER_QUESTIONS: Question[] = [
  { code: 'MFA_REMOTE', section: 'Access Control', text: 'Is multi-factor authentication (MFA) enforced for all remote network access (VPN, RDP, VDI)?', type: 'yesno', rating: { Yes: -0.05, No: 0.25 }, required: true },
  { code: 'MFA_EMAIL', section: 'Access Control', text: 'Is MFA enforced for all cloud email accounts?', type: 'yesno', rating: { Yes: -0.025, No: 0.1 }, required: true },
  { code: 'MFA_PRIVILEGED', section: 'Access Control', text: 'Is MFA enforced for all privileged / administrative accounts?', type: 'yesno', rating: { Yes: -0.025, No: 0.1 }, required: true },
  { code: 'EDR', section: 'Endpoint Security', text: 'Is an Endpoint Detection & Response (EDR) tool deployed on all endpoints and servers?', type: 'yesno', rating: { Yes: -0.075, No: 0.1 }, required: true },
  { code: 'MDR_SOC', section: 'Endpoint Security', text: 'Is the EDR monitored 24x7 by an internal SOC or MDR provider?', type: 'yesno', rating: { Yes: -0.05, No: 0 }, required: false },
  { code: 'BACKUPS_OFFLINE', section: 'Backups & Recovery', text: 'Are critical backups kept offline or immutable and segregated from the primary network?', type: 'yesno', rating: { Yes: -0.075, No: 0.15 }, required: true },
  { code: 'BACKUP_TESTED', section: 'Backups & Recovery', text: 'Have backups been successfully restore-tested in the past 12 months?', type: 'yesno', rating: { Yes: -0.025, No: 0.05 }, required: false },
  { code: 'PATCH_CADENCE', section: 'Vulnerability Management', text: 'Typical time to apply critical security patches', type: 'select', options: ['Within 7 days', 'Within 30 days', '31-90 days', 'Over 90 days'], rating: { 'Within 7 days': -0.05, 'Within 30 days': 0, '31-90 days': 0.05, 'Over 90 days': 0.15 }, required: true },
  { code: 'EOL_SOFTWARE', section: 'Vulnerability Management', text: 'Does the applicant run any end-of-life / unsupported operating systems or software?', type: 'yesno', rating: { Yes: 0.1, No: 0 }, required: true },
  { code: 'ENCRYPTION', section: 'Data Protection', text: 'Is sensitive data encrypted at rest and in transit, including on portable devices?', type: 'yesno', rating: { Yes: -0.025, No: 0.05 }, required: true },
  { code: 'PCI_COMPLIANT', section: 'Data Protection', text: 'If payment cards are accepted, is the applicant PCI-DSS compliant?', type: 'select', options: ['Yes', 'No', 'N/A - no card payments'], rating: { Yes: 0, No: 0.1, 'N/A - no card payments': 0 }, required: true },
  { code: 'TRAINING', section: 'People & Process', text: 'Do all employees complete security awareness and phishing simulation training at least annually?', type: 'yesno', rating: { Yes: -0.025, No: 0.05 }, required: true },
  { code: 'WIRE_VERIFY', section: 'People & Process', text: 'Are funds-transfer and vendor banking changes verified out-of-band (call-back) before execution?', type: 'yesno', rating: { Yes: -0.025, No: 0.075 }, required: true },
  { code: 'IR_PLAN', section: 'People & Process', text: 'Is there a documented and tested incident response plan?', type: 'yesno', rating: { Yes: -0.025, No: 0.025 }, required: true },
  { code: 'VENDOR_MGMT', section: 'People & Process', text: 'Are critical technology vendors assessed for security and contractually required to carry cyber insurance?', type: 'yesno', rating: { Yes: -0.02, No: 0.02 }, required: false },
  { code: 'PRIOR_INCIDENTS', section: 'Prior Incidents', text: 'Number of cyber incidents, breaches or ransomware events in the past 3 years', type: 'select', options: ['0', '1', '2 or more'], required: true },
  { code: 'PENDING_CLAIMS', section: 'Prior Incidents', text: 'Is the applicant aware of any circumstance that could give rise to a cyber claim?', type: 'yesno', required: true },
];

export const CYBER_LIMITS = [1_000_000, 2_000_000, 3_000_000, 5_000_000, 10_000_000];
export const CYBER_RETENTIONS = [2_500, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000];
export const CYBER_SE_LIMITS = [0, 100_000, 250_000, 500_000, 1_000_000];

export const CYBER_FORMS = [
  { number: 'CY 00 01 01 25', title: 'Cyber Liability and Data Breach Response Coverage Form' },
  { number: 'CY 00 10 01 25', title: 'Cyber Declarations' },
  { number: 'CY 05 02 01 25', title: 'Ransomware Sublimit and Coinsurance Endorsement' },
  { number: 'CY 05 10 01 25', title: 'Social Engineering Fraud Coverage Endorsement' },
  { number: 'CY 05 20 01 25', title: 'Dependent Business Interruption Endorsement' },
  { number: 'CY 05 30 01 25', title: 'Media Liability Coverage Endorsement' },
  { number: 'CY 09 01 01 25', title: 'War and Infrastructure Exclusion' },
  { number: 'IL 00 21 09 08', title: 'Nuclear Energy Liability Exclusion Endorsement' },
];

export function defaultCyberRisk(annualRevenue = 0, employeeCount = 0, website = ''): CyberRisk {
  const domain = website.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  return {
    product: 'CYBER',
    annualRevenue,
    employeeCount,
    piiRecords: 0,
    phiRecords: 0,
    pciRecords: 0,
    domains: domain ? [domain] : [],
    answers: {},
    coverages: {
      aggregateLimit: 1_000_000,
      retention: 10_000,
      ransomwareSublimitPct: 100,
      ransomwareCoinsurancePct: 0,
      socialEngineeringLimit: 250_000,
      dependentBI: true,
      mediaLiability: true,
      regulatoryFines: true,
      pciFines: false,
      biWaitingHours: 12,
    },
    scheduleMod: 0,
    scheduleModReason: '',
    losses: [],
    noLossesCertified: false,
  };
}

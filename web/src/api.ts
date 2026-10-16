import type {
  Account, ClearanceResult, CrpScanResult, Producer, Product, RiskData, Submission, User, UWIssue, Version,
} from '../../server/src/types';

export type { Account, ClearanceResult, CrpScanResult, Producer, Product, RiskData, Submission, User, UWIssue, Version };
export type { CyberRisk, PropertyRisk, GLRisk, Building, Location, GLExposure, Loss, PricingResult, QuoteSnapshot, Policy, PolicyPeriod, Subjectivity, Invoice, JobType } from '../../server/src/types';
import type { Invoice, JobType, Policy, PolicyPeriod, Subjectivity } from '../../server/src/types';

export class ApiError extends Error {
  constructor(message: string, public status: number, public details?: unknown) {
    super(message);
  }
}

export const STANDALONE = !!import.meta.env.VITE_STANDALONE;

let currentUserId = 0;
try {
  currentUserId = Number(localStorage.getItem('userId')) || 0;
} catch {
  /* storage unavailable */
}
export const setApiUser = (id: number) => {
  currentUserId = id;
  try {
    localStorage.setItem('userId', String(id));
  } catch {
    /* storage unavailable */
  }
};

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET');
  if (STANDALONE) {
    // Standalone build: the server code runs in this page against an in-browser database.
    const { localApi, LocalApiError } = await import('./standalone/backend');
    try {
      return (await localApi(method, path, currentUserId, opts.body, opts.form)) as T;
    } catch (e) {
      if (e instanceof LocalApiError) throw new ApiError(e.message, e.status, e.details);
      throw e;
    }
  }
  const headers: Record<string, string> = {};
  if (currentUserId) headers['X-User-Id'] = String(currentUserId);
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(data?.error ?? res.statusText, res.status, data?.details);
  return data as T;
}

export interface SubmissionRow {
  id: number;
  jobNumber: string;
  jobType: JobType;
  jobTypeLabel: string;
  product: Product;
  productName: string;
  status: Submission['status'];
  statusLabel: string;
  effectiveDate: string;
  receivedDate: string;
  priority: string;
  updatedAt: string;
  accountId: number;
  accountName: string;
  accountNumber: string;
  state: string;
  producerName: string;
  underwriterName: string | null;
  premium: number | null;
}

export interface ValidationMessage {
  level: 'error' | 'warning';
  step: string;
  message: string;
}

export interface SubmissionDetail {
  submission: Submission & { statusLabel: string };
  account: Account;
  producer: Producer;
  underwriter: User | null;
  versions: Version[];
  selectedVersionId: number;
  issues: UWIssue[];
  validation: ValidationMessage[];
  quoteBlockers: string[];
  subjectivities: string[];
  subjectivityItems: Subjectivity[];
  jobTypeLabel: string;
  policy: { id: number; policyNumber: string; status: string } | null;
  premiumSummary: PremiumSummary | null;
  basePeriod: PolicyPeriod | null;
  bindBlockers: string[];
  paymentPlans: Record<string, { installments: number; downPct: number; months: number; fee: number }>;
  billingMethods: string[];
  quotes: { id: number; versionId: number; quoteNumber: string; premium: number; totalCost: number; validUntil: string; status: string; createdBy: string; createdAt: string }[];
  documents: { id: number; name: string; docType: string; mimeType: string; size: number | null; quoteId: number | null; policyId: number | null; viewable: number; uploadedBy: string; createdAt: string }[];
  notes: { id: number; topic: string; subject: string; body: string; author: string; created_at: string }[];
  activities: { id: number; subject: string; description: string; assigned_name: string; priority: string; due_date: string; status: string; created_at: string }[];
  history: { id: number; event: string; detail: string; user_name: string; created_at: string }[];
}

export const money = (n: number | null | undefined) =>
  n === null || n === undefined || Number.isNaN(n) ? '-' : `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
export const fmtDate = (d: string | null | undefined) => (d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-US') : '-');
export const fmtDateTime = (d: string | null | undefined) => (d ? new Date(d).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' }) : '-');

export interface PremiumSummary {
  kind: JobType;
  priorAnnualPremium?: number;
  newAnnualPremium?: number;
  proRataFactor?: number;
  transactionPremium?: number;
  priorTermPremium?: number;
  newTermPremium?: number;
  daysRemaining?: number;
  termDays?: number;
}

export interface PolicyRow {
  id: number;
  policyNumber: string;
  product: Product;
  productName: string;
  status: string;
  accountId: number;
  accountName: string;
  state: string;
  producerName: string;
  underwriterName: string | null;
  periodStart?: string;
  periodEnd?: string;
  termNumber?: number;
  termPremium: number;
}

export interface PolicyDetail {
  policy: Policy;
  summary: PolicyRow;
  account: Account;
  producer: Producer;
  underwriter: User | null;
  currentPeriod: PolicyPeriod;
  periods: PolicyPeriod[];
  transactions: { id: number; jobNumber: string; jobType: JobType; jobTypeLabel: string; status: string; effectiveDate: string; description: string; transactionPremium: number | null; termNumber: number | null; modelNumber: number | null; createdAt: string }[];
  openTransactions: { id: number; jobNumber: string; jobTypeLabel: string; status: string }[];
  invoices: Invoice[];
  billing: { billed: number; paid: number; outstanding: number; unbilled: number; paymentPlan: string; billingMethod: string };
  renewal: { id: number; jobNumber: string; status: string } | null;
  renewalWindowOpen: boolean;
  documents: { id: number; name: string; docType: string; jobId: number; createdAt: string }[];
  history: { id: number; event: string; detail: string; user_name: string; created_at: string; jobNumber: string }[];
  reference: { cancellationReasons: Record<'Insured' | 'Carrier', { reason: string; noticeDays: number }[]>; cancellationMethods: string[] };
}

export const STATUS_TEXT: Record<string, string> = {
  INTAKE: 'Intake', CLEARANCE_REFERRAL: 'Clearance Referral', DRAFT: 'Draft', RATED: 'Rated', QUOTED: 'Quoted', BOUND: 'Bound',
  DECLINED: 'Declined', WITHDRAWN: 'Withdrawn', NON_RENEWED: 'Non-Renewed',
};

/** Badge class for a policy status. */
export const policyBadge = (s: string) =>
  s === 'In Force' ? 'PASS' : s === 'Canceled' || s === 'Expired' ? 'DECLINE' : s === 'Pending Cancellation' || s.startsWith('Bound') ? 'REFER' : 'DRAFT';

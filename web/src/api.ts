import type {
  Account, ClearanceResult, CrpScanResult, Producer, Product, RiskData, Submission, User, UWIssue, Version,
} from '../../server/src/types';

export type { Account, ClearanceResult, CrpScanResult, Producer, Product, RiskData, Submission, User, UWIssue, Version };
export type { CyberRisk, PropertyRisk, GLRisk, Building, Location, GLExposure, Loss, PricingResult } from '../../server/src/types';

export class ApiError extends Error {
  constructor(message: string, public status: number, public details?: unknown) {
    super(message);
  }
}

let currentUserId = Number(localStorage.getItem('userId')) || 0;
export const setApiUser = (id: number) => {
  currentUserId = id;
  try {
    localStorage.setItem('userId', String(id));
  } catch {
    /* storage unavailable */
  }
};

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (currentUserId) headers['X-User-Id'] = String(currentUserId);
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET'),
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
  quotes: { id: number; versionId: number; quoteNumber: string; premium: number; totalCost: number; validUntil: string; status: string; createdBy: string; createdAt: string }[];
  documents: { id: number; name: string; docType: string; mimeType: string; size: number | null; quoteId: number | null; uploadedBy: string; createdAt: string }[];
  notes: { id: number; topic: string; subject: string; body: string; author: string; created_at: string }[];
  activities: { id: number; subject: string; description: string; assigned_name: string; priority: string; due_date: string; status: string; created_at: string }[];
  history: { id: number; event: string; detail: string; user_name: string; created_at: string }[];
}

export const money = (n: number | null | undefined) => (n === null || n === undefined ? '-' : `$${Math.round(n).toLocaleString('en-US')}`);
export const fmtDate = (d: string | null | undefined) => (d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-US') : '-');
export const fmtDateTime = (d: string | null | undefined) => (d ? new Date(d).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' }) : '-');

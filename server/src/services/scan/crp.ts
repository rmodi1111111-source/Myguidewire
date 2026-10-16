// CRP (Comprehensive Risk Profile) scan.
//
// A pluggable risk-intelligence scan run during Risk Analysis:
//  - Cyber:    outside-in attack-surface / security-posture scan of the insured's domains
//  - Property: natural-catastrophe and site hazard profile per location
//  - GL:       operations hazard, litigation environment and regulatory history
//
// The built-in provider is a deterministic simulator (same input => same result) so the
// workflow can be demonstrated without vendor credentials. Swap in a real vendor by
// implementing ScanProvider and registering it in PROVIDERS.

import type { Account, CrpScanResult, CyberRisk, GLRisk, Location, PropertyRisk, RiskData, ScanFinding, ScanSection } from '../../types.js';
import { LITIGATION_ENVIRONMENT } from '../../products/reference.js';
import { glClass } from '../../products/gl.js';
import { gradeFor, seededRandom } from './prng.js';

export interface ScanProvider {
  name: string;
  scan(account: Account, risk: RiskData): CrpScanResult;
}

const MAX = 950;
const MIN = 300;
const clampScore = (n: number) => Math.max(MIN, Math.min(MAX, Math.round(n)));

function section(name: string, findings: ScanFinding[], summary: ScanSection['summary']): ScanSection {
  const score = clampScore(MAX - findings.reduce((s, f) => s + f.impact, 0));
  return { name, score, grade: gradeFor(score), summary, findings };
}

// ---------------------------------------------------------------- Cyber

const KEV_VULNS = [
  'Ivanti Connect Secure VPN - CVE-2024-21887 (command injection, CISA KEV)',
  'Fortinet FortiOS SSL-VPN - CVE-2024-21762 (out-of-bounds write, CISA KEV)',
  'Citrix NetScaler ADC - CVE-2023-4966 "Citrix Bleed" (CISA KEV)',
  'Microsoft Exchange - CVE-2021-26855 "ProxyLogon" (CISA KEV)',
  'MOVEit Transfer - CVE-2023-34362 (SQL injection, CISA KEV)',
  'Palo Alto PAN-OS GlobalProtect - CVE-2024-3400 (CISA KEV)',
];
const EOL_SOFTWARE = ['Windows Server 2012 R2', 'Microsoft Exchange 2013', 'Apache httpd 2.2', 'PHP 5.6', 'Windows 7 endpoints', 'OpenSSL 1.0.2'];

export function cyberDomainFindings(domain: string): { findings: ScanFinding[]; summary: Record<string, string | number | boolean> } {
  const r = seededRandom(`cyber:${domain.toLowerCase()}`);
  const f: ScanFinding[] = [];
  const openPorts: string[] = ['443/https'];
  if (r() < 0.5) openPorts.push('80/http');
  if (r() < 0.15) {
    openPorts.push('3389/rdp');
    f.push({ code: 'RDP_EXPOSED', category: 'External Attack Surface', title: 'Remote Desktop (RDP) exposed to the internet', severity: 'Critical', detail: `TCP/3389 open on ${domain} perimeter host. RDP is the leading initial-access vector for ransomware.`, impact: 120 });
  }
  if (r() < 0.07) {
    openPorts.push('445/smb');
    f.push({ code: 'SMB_EXPOSED', category: 'External Attack Surface', title: 'SMB file sharing exposed to the internet', severity: 'Critical', detail: 'TCP/445 reachable from the internet.', impact: 100 });
  }
  if (r() < 0.09) {
    const db = r() < 0.5 ? '3306/mysql' : '27017/mongodb';
    openPorts.push(db);
    f.push({ code: 'DB_EXPOSED', category: 'External Attack Surface', title: 'Database service exposed to the internet', severity: 'High', detail: `${db} accepts external connections.`, impact: 80 });
  }
  if (r() < 0.13) {
    const v = KEV_VULNS[Math.floor(r() * KEV_VULNS.length)];
    f.push({ code: 'KEV_VULN', category: 'External Attack Surface', title: 'Known exploited vulnerability detected', severity: 'Critical', detail: v, impact: 150 });
  }
  if (r() < 0.25) {
    const s = EOL_SOFTWARE[Math.floor(r() * EOL_SOFTWARE.length)];
    f.push({ code: 'EOL_SOFTWARE', category: 'External Attack Surface', title: 'End-of-life software observed', severity: 'High', detail: `${s} fingerprinted on an internet-facing asset.`, impact: 50 });
  }
  const tlsRoll = r();
  const tlsGrade = tlsRoll < 0.5 ? 'A' : tlsRoll < 0.75 ? 'B' : tlsRoll < 0.9 ? 'C' : 'F';
  if (tlsGrade === 'C') f.push({ code: 'TLS_WEAK', category: 'Web & Encryption', title: 'Weak TLS configuration', severity: 'Medium', detail: 'TLS 1.0/1.1 enabled or weak cipher suites offered.', impact: 30 });
  if (tlsGrade === 'F') f.push({ code: 'TLS_EXPIRED', category: 'Web & Encryption', title: 'Expired or invalid TLS certificate', severity: 'High', detail: 'Primary web certificate is expired or untrusted.', impact: 60 });
  if (tlsGrade === 'B') f.push({ code: 'TLS_HSTS', category: 'Web & Encryption', title: 'HSTS not enforced', severity: 'Low', detail: 'Strict-Transport-Security header missing.', impact: 10 });

  const spf = r() >= 0.12;
  if (!spf) f.push({ code: 'SPF_MISSING', category: 'Email Security', title: 'SPF record missing', severity: 'Medium', detail: 'No SPF record published; domain can be spoofed.', impact: 20 });
  const dmarcRoll = r();
  const dmarc = dmarcRoll < 0.15 ? 'missing' : dmarcRoll < 0.5 ? 'p=none' : dmarcRoll < 0.75 ? 'p=quarantine' : 'p=reject';
  if (dmarc === 'missing') f.push({ code: 'DMARC_MISSING', category: 'Email Security', title: 'DMARC record missing', severity: 'Medium', detail: 'No DMARC policy; elevated business email compromise risk.', impact: 35 });
  if (dmarc === 'p=none') f.push({ code: 'DMARC_NONE', category: 'Email Security', title: 'DMARC policy not enforced (p=none)', severity: 'Low', detail: 'DMARC in monitor-only mode.', impact: 15 });
  const dkim = r() >= 0.2;
  if (!dkim) f.push({ code: 'DKIM_MISSING', category: 'Email Security', title: 'DKIM signing not detected', severity: 'Low', detail: 'No DKIM selector found for common providers.', impact: 10 });

  const leaked = Math.floor(Math.pow(r(), 3) * 60);
  if (leaked > 20) f.push({ code: 'CRED_LEAK_HIGH', category: 'Dark Web Exposure', title: `${leaked} leaked credentials in past 12 months`, severity: 'High', detail: 'Corporate credentials found in recent breach dumps / infostealer logs.', impact: 50 });
  else if (leaked > 5) f.push({ code: 'CRED_LEAK', category: 'Dark Web Exposure', title: `${leaked} leaked credentials in past 12 months`, severity: 'Medium', detail: 'Corporate credentials found in breach dumps.', impact: 20 });
  const lookalikes = Math.floor(r() * 8);
  if (lookalikes > 4) f.push({ code: 'LOOKALIKE', category: 'Dark Web Exposure', title: `${lookalikes} lookalike domains registered`, severity: 'Low', detail: 'Typosquat domains suitable for phishing were registered recently.', impact: 10 });
  const patchDays = Math.round(10 + r() * 120);
  if (patchDays > 90) f.push({ code: 'PATCH_SLOW', category: 'External Attack Surface', title: `Slow patching cadence (~${patchDays} days)`, severity: 'High', detail: 'Observed average time to remediate public vulnerabilities.', impact: 40 });
  else if (patchDays > 45) f.push({ code: 'PATCH_MODERATE', category: 'External Attack Surface', title: `Moderate patching cadence (~${patchDays} days)`, severity: 'Medium', detail: 'Observed average time to remediate public vulnerabilities.', impact: 15 });

  return {
    findings: f.map((x) => ({ ...x, detail: `[${domain}] ${x.detail}` })),
    summary: { openPorts: openPorts.join(', '), tlsGrade, spf, dmarc, dkim, leakedCredentials: leaked, lookalikeDomains: lookalikes, patchCadenceDays: patchDays },
  };
}

function cyberScan(account: Account, risk: CyberRisk): ScanSection[] {
  const domains = risk.domains.length ? risk.domains : account.website ? [account.website] : [];
  if (!domains.length) {
    return [section('External Attack Surface', [{ code: 'NO_DOMAIN', category: 'External Attack Surface', title: 'No domain provided', severity: 'High', detail: 'Scan could not be performed without a domain.', impact: 200 }], { domains: 'none' })];
  }
  const all = domains.map((d) => cyberDomainFindings(d.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')));
  const findings = all.flatMap((a) => a.findings);
  const byCat = (c: string) => findings.filter((f) => f.category === c);
  const s0 = all[0].summary;
  return [
    section('External Attack Surface', byCat('External Attack Surface'), { domains: domains.join(', '), openPorts: String(s0.openPorts), patchCadenceDays: s0.patchCadenceDays }),
    section('Web & Encryption', byCat('Web & Encryption'), { tlsGrade: s0.tlsGrade }),
    section('Email Security', byCat('Email Security'), { spf: s0.spf, dmarc: s0.dmarc, dkim: s0.dkim }),
    section('Dark Web Exposure', byCat('Dark Web Exposure'), { leakedCredentials: s0.leakedCredentials, lookalikeDomains: s0.lookalikeDomains }),
  ];
}

// ---------------------------------------------------------------- Property

const HURRICANE_STATES = ['FL', 'TX', 'LA', 'MS', 'AL', 'SC', 'NC', 'GA'];
const ATLANTIC_STATES = ['NY', 'NJ', 'MA', 'CT', 'RI', 'VA', 'MD', 'DE', 'ME', 'NH'];
const HAIL_STATES = ['TX', 'OK', 'KS', 'NE', 'CO', 'SD', 'MN', 'IA', 'MO'];
const QUAKE_HIGH = ['CA', 'AK'];
const QUAKE_MOD = ['WA', 'OR', 'NV', 'UT', 'MO', 'TN', 'SC', 'HI'];
const WILDFIRE_STATES = ['CA', 'CO', 'OR', 'WA', 'AZ', 'NM', 'ID', 'MT', 'NV', 'UT'];

export interface LocationHazard {
  windTier: 1 | 2 | 3;
  hail: 'High' | 'Moderate' | 'Low';
  floodZone: 'AE' | 'A' | 'X (shaded)' | 'X';
  quake: 'High' | 'Moderate' | 'Low';
  wildfire: 'High' | 'Moderate' | 'Low';
  distanceToCoastMiles: number;
  crimeIndex: number;
}

export function locationHazard(loc: Pick<Location, 'state' | 'zip' | 'address1'>): LocationHazard {
  const r = seededRandom(`haz:${loc.state}:${loc.zip}:${loc.address1.toLowerCase()}`);
  const coastal = HURRICANE_STATES.includes(loc.state);
  const atlantic = ATLANTIC_STATES.includes(loc.state);
  const w = r();
  const windTier: 1 | 2 | 3 = coastal ? (w < 0.5 ? 1 : 2) : atlantic ? (w < 0.3 ? 2 : 3) : 3;
  const distanceToCoastMiles = coastal || atlantic ? Math.round(windTier === 1 ? 1 + r() * 9 : 10 + r() * 60) : Math.round(200 + r() * 600);
  const fl = r();
  const floodZone = fl < 0.08 ? 'AE' : fl < 0.14 ? 'A' : fl < 0.3 ? 'X (shaded)' : 'X';
  const quake = QUAKE_HIGH.includes(loc.state) ? 'High' : QUAKE_MOD.includes(loc.state) ? 'Moderate' : 'Low';
  const wf = r();
  const wildfire = WILDFIRE_STATES.includes(loc.state) ? (wf < 0.35 ? 'High' : 'Moderate') : 'Low';
  const hail = HAIL_STATES.includes(loc.state) ? 'High' : r() < 0.3 ? 'Moderate' : 'Low';
  const crimeIndex = 1 + Math.floor(r() * 10);
  return { windTier, hail, floodZone, quake, wildfire, distanceToCoastMiles, crimeIndex };
}

function propertyScan(risk: PropertyRisk): ScanSection[] {
  return risk.locations.map((loc) => {
    const h = locationHazard(loc);
    const f: ScanFinding[] = [];
    const cat = 'Natural Hazards';
    if (h.windTier === 1) f.push({ code: 'WIND_TIER1', category: cat, title: 'Tier 1 named-storm wind zone', severity: 'Critical', detail: `${h.distanceToCoastMiles} miles to coast.`, impact: 150 });
    if (h.windTier === 2) f.push({ code: 'WIND_TIER2', category: cat, title: 'Tier 2 wind zone', severity: 'Medium', detail: `${h.distanceToCoastMiles} miles to coast.`, impact: 60 });
    if (h.floodZone === 'AE' || h.floodZone === 'A') f.push({ code: 'FLOOD_SFHA', category: cat, title: `Special Flood Hazard Area (Zone ${h.floodZone})`, severity: 'High', detail: '1% annual chance flood zone per FEMA FIRM.', impact: 120 });
    if (h.floodZone === 'X (shaded)') f.push({ code: 'FLOOD_500', category: cat, title: 'Moderate flood hazard (Zone X shaded)', severity: 'Low', detail: '0.2% annual chance flood zone.', impact: 20 });
    if (h.quake === 'High') f.push({ code: 'QUAKE_HIGH', category: cat, title: 'High seismic hazard', severity: 'High', detail: 'Peak ground acceleration in top decile.', impact: 100 });
    if (h.quake === 'Moderate') f.push({ code: 'QUAKE_MOD', category: cat, title: 'Moderate seismic hazard', severity: 'Medium', detail: 'Moderate peak ground acceleration.', impact: 40 });
    if (h.wildfire === 'High') f.push({ code: 'WILDFIRE_HIGH', category: cat, title: 'High wildfire risk (WUI)', severity: 'High', detail: 'Wildland-urban interface with high fuel load.', impact: 100 });
    if (h.wildfire === 'Moderate') f.push({ code: 'WILDFIRE_MOD', category: cat, title: 'Moderate wildfire risk', severity: 'Medium', detail: 'Moderate wildfire exposure.', impact: 30 });
    if (h.hail === 'High') f.push({ code: 'HAIL_HIGH', category: cat, title: 'High hail frequency', severity: 'Medium', detail: 'Located in high-frequency hail corridor.', impact: 40 });
    if (h.crimeIndex >= 8) f.push({ code: 'CRIME_HIGH', category: 'Site', title: `Elevated crime index (${h.crimeIndex}/10)`, severity: 'Medium', detail: 'Theft/vandalism exposure above average.', impact: 30 });
    return section(`Location ${loc.number} - ${loc.city || 'Unknown'}, ${loc.state}`, f, {
      windTier: h.windTier, hail: h.hail, floodZone: h.floodZone, quake: h.quake, wildfire: h.wildfire,
      distanceToCoastMiles: h.distanceToCoastMiles, crimeIndex: h.crimeIndex,
    });
  });
}

// ---------------------------------------------------------------- GL

function glScan(account: Account, risk: GLRisk): ScanSection[] {
  const r = seededRandom(`gl:${account.name.toLowerCase()}:${account.fein}`);
  const ops: ScanFinding[] = [];
  const classes = risk.exposures.map((e) => glClass(e.classCode)).filter(Boolean);
  if (classes.some((c) => c!.hazard === 'High')) ops.push({ code: 'GL_HIGH_HAZARD', category: 'Operations', title: 'High-hazard operations', severity: 'High', detail: classes.filter((c) => c!.hazard === 'High').map((c) => c!.description).join(', '), impact: 120 });
  if (classes.some((c) => c!.productsRate > 0.5)) ops.push({ code: 'GL_PRODUCTS', category: 'Operations', title: 'Significant products / completed operations exposure', severity: 'Medium', detail: 'Manufacturing or contracting operations with completed-ops tail.', impact: 40 });
  const osha = Math.floor(Math.pow(r(), 2) * 5);
  if (osha >= 2) ops.push({ code: 'OSHA', category: 'Regulatory', title: `${osha} OSHA citations in past 5 years`, severity: osha >= 3 ? 'High' : 'Medium', detail: 'Public OSHA inspection records matched to insured.', impact: osha >= 3 ? 60 : 25 });
  const recalls = r() < 0.08 ? 1 : 0;
  if (recalls) ops.push({ code: 'RECALL', category: 'Regulatory', title: 'Product recall on record', severity: 'High', detail: 'CPSC recall notice matched to insured.', impact: 60 });
  const suits = Math.floor(Math.pow(r(), 2.5) * 6);
  if (suits >= 2) ops.push({ code: 'LITIGATION_HIST', category: 'Legal', title: `${suits} bodily-injury lawsuits in past 5 years`, severity: 'Medium', detail: 'Court docket search (state and federal).', impact: 15 * suits });

  const legal: ScanFinding[] = [];
  const states = [...new Set(risk.locations.map((l) => l.state).filter(Boolean))];
  for (const st of states) {
    const env = LITIGATION_ENVIRONMENT[st];
    if (env === 'Severe') legal.push({ code: 'LITIGATION_SEVERE', category: 'Legal', title: `Severe litigation environment (${st})`, severity: 'High', detail: 'Venue with elevated nuclear verdict frequency and social inflation.', impact: 60 });
    if (env === 'Elevated') legal.push({ code: 'LITIGATION_ELEVATED', category: 'Legal', title: `Elevated litigation environment (${st})`, severity: 'Medium', detail: 'Above-average jury award severity.', impact: 25 });
  }
  return [
    section('Operations & Regulatory', ops, { classCodes: risk.exposures.map((e) => e.classCode).join(', ') || 'none', oshaCitations: osha, productRecalls: recalls, bodilyInjurySuits: suits }),
    section('Legal Environment', legal, { states: states.join(', ') || 'none' }),
  ];
}

// ---------------------------------------------------------------- Provider

export const SimulatedCrpProvider: ScanProvider = {
  name: 'CRP Simulator v1 (deterministic)',
  scan(account, risk) {
    const sections =
      risk.product === 'CYBER' ? cyberScan(account, risk) : risk.product === 'PROPERTY' ? propertyScan(risk) : glScan(account, risk);
    const totalImpact = sections.flatMap((s) => s.findings).reduce((s, f) => s + f.impact, 0);
    const compositeScore = clampScore(MAX - totalImpact);
    return { runAt: new Date().toISOString(), provider: this.name, product: risk.product, compositeScore, grade: gradeFor(compositeScore), sections };
  },
};

export const PROVIDERS: Record<string, ScanProvider> = { simulated: SimulatedCrpProvider };

export function runCrpScan(account: Account, risk: RiskData): CrpScanResult {
  const provider = PROVIDERS[(typeof process !== 'undefined' && process.env?.CRP_PROVIDER) || 'simulated'] ?? SimulatedCrpProvider;
  return provider.scan(account, risk);
}

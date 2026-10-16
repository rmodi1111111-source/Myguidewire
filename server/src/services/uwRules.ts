// Underwriting rules: evaluate a version and produce UW issues (PolicyCenter-style
// "Underwriter Issues" with blocking point and required approval authority).

import { glClass, GL_LIMIT_OPTIONS } from '../products/gl.js';
import { LITIGATION_ENVIRONMENT } from '../products/reference.js';
import type { Account, BlockingPoint, ClearanceResult, CrpScanResult, PricingResult, RiskData, Submission } from '../types.js';
import { lossExperience } from './rating/common.js';
import { tiv } from './rating/property.js';
import { locationHazard } from './scan/crp.js';

export interface IssueTemplate {
  code: string;
  shortDescription: string;
  longDescription: string;
  blockingPoint: BlockingPoint;
  requiredAuthority: number;
  value: string;
  subjectivity?: string;
}

export interface RuleContext {
  submission: Submission;
  account: Account;
  risk: RiskData;
  scan: CrpScanResult | null;
  pricing: PricingResult | null;
  clearance: ClearanceResult | null;
  today?: string;
}

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

export function evaluateRules(ctx: RuleContext): IssueTemplate[] {
  const out: IssueTemplate[] = [];
  const add = (i: IssueTemplate) => out.push(i);
  const { risk, scan, pricing, submission, account } = ctx;
  const today = ctx.today ?? new Date().toISOString().slice(0, 10);

  // ---- Common rules
  if (submission.effectiveDate < today) {
    add({ code: 'BACKDATED', shortDescription: 'Effective date is in the past', longDescription: `Effective date ${submission.effectiveDate} precedes today. A no-known-loss letter is required.`, blockingPoint: 'Quote', requiredAuthority: 2, value: submission.effectiveDate, subjectivity: 'Signed no-known-loss letter dated on or after the effective date' });
  }
  if (ctx.clearance?.override) {
    add({ code: 'CLEARANCE_OVERRIDE', shortDescription: 'Clearance was overridden', longDescription: `Clearance outcome ${ctx.clearance.outcome} overridden by ${ctx.clearance.override.by}: ${ctx.clearance.override.reason}`, blockingPoint: 'Informational', requiredAuthority: 1, value: ctx.clearance.outcome });
  }
  const sm = Math.abs(Number(risk.scheduleMod) || 0);
  if (sm > 10) {
    add({ code: 'SCHEDULE_MOD', shortDescription: `Schedule rating of ${risk.scheduleMod}% exceeds authority`, longDescription: 'Schedule rating beyond +/-10% requires senior approval; beyond +/-20% requires manager approval.', blockingPoint: 'Quote', requiredAuthority: sm > 20 ? 3 : 2, value: String(risk.scheduleMod) });
  }
  if (!risk.losses.length && !risk.noLossesCertified) {
    add({ code: 'LOSS_RUNS', shortDescription: 'Loss runs not received', longDescription: 'No loss history entered and no-loss certification not provided.', blockingPoint: 'Bind', requiredAuthority: 1, value: 'missing', subjectivity: 'Currently valued (within 90 days) 5-year loss runs from prior carrier(s)' });
  }
  const le = lossExperience(risk.losses, submission.effectiveDate);
  if (le.count >= 3 || le.largeLoss) {
    add({ code: 'LOSS_HISTORY', shortDescription: 'Adverse loss history', longDescription: `${le.count} losses totalling ${money(le.incurred)} in 5 years${le.largeLoss ? ' including a loss over $100,000' : ''}.`, blockingPoint: 'Quote', requiredAuthority: 2, value: `${le.count}/${Math.round(le.incurred)}` });
  }
  if (pricing && pricing.premium > 250_000) {
    add({ code: 'PREMIUM_AUTHORITY', shortDescription: `Premium ${money(pricing.premium)} exceeds $250,000`, longDescription: 'Large premium accounts require underwriting manager approval.', blockingPoint: 'Quote', requiredAuthority: 3, value: String(Math.round(pricing.premium / 10_000)) });
  } else if (pricing && pricing.premium > 100_000) {
    add({ code: 'PREMIUM_AUTHORITY', shortDescription: `Premium ${money(pricing.premium)} exceeds $100,000`, longDescription: 'Premium above $100,000 requires senior underwriter approval.', blockingPoint: 'Quote', requiredAuthority: 2, value: String(Math.round(pricing.premium / 10_000)) });
  }

  // ---- Product rules
  if (risk.product === 'CYBER') {
    const a = risk.answers;
    const c = risk.coverages;
    if (a.MFA_REMOTE === 'No') add({ code: 'CY_MFA_REMOTE', shortDescription: 'No MFA on remote access', longDescription: 'Applicant does not enforce MFA for remote network access. Ransomware coverage requires MFA or a coinsurance/sublimit structure.', blockingPoint: 'Quote', requiredAuthority: 2, value: 'No', subjectivity: 'Written confirmation that MFA is enforced for all remote access prior to binding' });
    if (a.MFA_EMAIL === 'No') add({ code: 'CY_MFA_EMAIL', shortDescription: 'No MFA on email', longDescription: 'Cloud email accounts are not protected by MFA (BEC exposure).', blockingPoint: 'Bind', requiredAuthority: 1, value: 'No', subjectivity: 'Confirmation of MFA on all cloud email accounts' });
    if (a.BACKUPS_OFFLINE === 'No') add({ code: 'CY_BACKUPS', shortDescription: 'No offline / immutable backups', longDescription: 'Backups are not segregated; ransomware recovery is at risk.', blockingPoint: 'Quote', requiredAuthority: 2, value: 'No' });
    if (a.EDR === 'No') add({ code: 'CY_EDR', shortDescription: 'No EDR deployed', longDescription: 'Endpoint detection and response is not deployed across endpoints.', blockingPoint: 'Quote', requiredAuthority: 2, value: 'No', subjectivity: 'Evidence of EDR deployment across all endpoints within 60 days of binding' });
    if (a.PATCH_CADENCE === 'Over 90 days') add({ code: 'CY_PATCHING', shortDescription: 'Critical patches applied after 90+ days', longDescription: 'Patching cadence exceeds 90 days.', blockingPoint: 'Quote', requiredAuthority: 2, value: a.PATCH_CADENCE });
    if (a.PCI_COMPLIANT === 'No') add({ code: 'CY_PCI', shortDescription: 'Not PCI-DSS compliant', longDescription: 'Applicant accepts card payments but is not PCI compliant.', blockingPoint: 'Quote', requiredAuthority: 2, value: 'No' });
    if (a.PCI_COMPLIANT === 'No' && c.pciFines) add({ code: 'CY_PCI_FINES', shortDescription: 'PCI fines requested for non-compliant merchant', longDescription: 'PCI fines and assessments coverage cannot be offered without PCI compliance.', blockingPoint: 'Quote', requiredAuthority: 3, value: 'No' });
    if (a.WIRE_VERIFY === 'No' && c.socialEngineeringLimit > 0) add({ code: 'CY_SOCIAL_ENG', shortDescription: 'Social engineering without call-back verification', longDescription: 'Funds transfer verification controls are absent while social engineering coverage is requested.', blockingPoint: 'Quote', requiredAuthority: 2, value: String(c.socialEngineeringLimit) });
    if (a.PRIOR_INCIDENTS && a.PRIOR_INCIDENTS !== '0') add({ code: 'CY_PRIOR_INCIDENT', shortDescription: `Prior cyber incidents: ${a.PRIOR_INCIDENTS}`, longDescription: 'Applicant reported cyber incidents in the past 3 years. Obtain incident details and remediation.', blockingPoint: 'Quote', requiredAuthority: 2, value: a.PRIOR_INCIDENTS, subjectivity: 'Incident narrative and evidence of remediation for each prior incident' });
    if (a.PENDING_CLAIMS === 'Yes') add({ code: 'CY_KNOWN_CIRCUMSTANCE', shortDescription: 'Known circumstance disclosed', longDescription: 'Applicant is aware of a circumstance that could give rise to a claim; a specific exclusion may be required.', blockingPoint: 'Quote', requiredAuthority: 3, value: 'Yes' });
    const unanswered = ['MFA_REMOTE', 'MFA_EMAIL', 'EDR', 'BACKUPS_OFFLINE', 'PATCH_CADENCE', 'PRIOR_INCIDENTS'].filter((q) => !a[q]);
    if (unanswered.length) add({ code: 'CY_INCOMPLETE_APP', shortDescription: 'Application incomplete', longDescription: `Required questions not answered: ${unanswered.join(', ')}`, blockingPoint: 'Quote', requiredAuthority: 3, value: unanswered.join(',') });
    if (risk.annualRevenue > 250_000_000) add({ code: 'CY_REVENUE', shortDescription: `Revenue ${money(risk.annualRevenue)} above $250M`, longDescription: 'Large-revenue cyber risks require referral.', blockingPoint: 'Quote', requiredAuthority: risk.annualRevenue > 500_000_000 ? 3 : 2, value: String(risk.annualRevenue) });
    if (c.aggregateLimit > 2_000_000) add({ code: 'CY_LIMIT', shortDescription: `Limit ${money(c.aggregateLimit)} exceeds authority`, longDescription: 'Limits above $2M require senior approval; above $5M manager approval.', blockingPoint: 'Quote', requiredAuthority: c.aggregateLimit > 5_000_000 ? 3 : 2, value: String(c.aggregateLimit) });
    const records = risk.piiRecords + risk.phiRecords + risk.pciRecords;
    if (records >= 10_000_000) add({ code: 'CY_RECORDS', shortDescription: `${records.toLocaleString()} sensitive records`, longDescription: 'Very large record count drives breach severity.', blockingPoint: 'Quote', requiredAuthority: 2, value: String(records) });
    if (!risk.domains.length) add({ code: 'CY_NO_DOMAIN', shortDescription: 'No domain provided', longDescription: 'At least one primary domain is required for the CRP scan.', blockingPoint: 'Quote', requiredAuthority: 3, value: 'none' });
    if (!scan || scan.product !== 'CYBER') {
      add({ code: 'CRP_NOT_RUN', shortDescription: 'CRP scan not performed', longDescription: 'A CRP security posture scan must be run before quoting.', blockingPoint: 'Quote', requiredAuthority: 3, value: 'none' });
    } else {
      const findings = scan.sections.flatMap((s) => s.findings);
      const has = (code: string) => findings.some((f) => f.code === code);
      if (has('RDP_EXPOSED')) add({ code: 'CY_SCAN_RDP', shortDescription: 'CRP scan: RDP exposed to internet', longDescription: 'Open RDP detected on the perimeter.', blockingPoint: 'Quote', requiredAuthority: 2, value: 'RDP', subjectivity: 'Closure of internet-exposed RDP (port 3389) verified by rescan prior to binding' });
      if (has('SMB_EXPOSED') || has('DB_EXPOSED')) add({ code: 'CY_SCAN_EXPOSED_SVC', shortDescription: 'CRP scan: sensitive services exposed', longDescription: 'SMB or database services reachable from the internet.', blockingPoint: 'Quote', requiredAuthority: 2, value: 'exposed', subjectivity: 'Remediation of internet-exposed SMB/database services verified by rescan prior to binding' });
      const kev = findings.filter((f) => f.code === 'KEV_VULN');
      if (kev.length) add({ code: 'CY_SCAN_KEV', shortDescription: 'CRP scan: known exploited vulnerability', longDescription: kev.map((k) => k.detail).join('; '), blockingPoint: 'Quote', requiredAuthority: 3, value: String(kev.length), subjectivity: 'Evidence of patching of all CISA KEV vulnerabilities identified in the CRP scan' });
      if (has('EOL_SOFTWARE')) add({ code: 'CY_SCAN_EOL', shortDescription: 'CRP scan: end-of-life software', longDescription: 'Unsupported software observed on internet-facing assets.', blockingPoint: 'Bind', requiredAuthority: 1, value: 'EOL', subjectivity: 'Decommissioning or isolation plan for end-of-life systems' });
      if (has('DMARC_MISSING') || has('SPF_MISSING')) add({ code: 'CY_SCAN_EMAIL', shortDescription: 'CRP scan: email authentication gaps', longDescription: 'SPF and/or DMARC not configured.', blockingPoint: 'Informational', requiredAuthority: 1, value: 'email' });
      if (scan.compositeScore < 550) add({ code: 'CY_SCAN_SCORE', shortDescription: `CRP posture score ${scan.compositeScore} (grade ${scan.grade})`, longDescription: 'Security posture score below 550 indicates poor external hygiene.', blockingPoint: 'Quote', requiredAuthority: 3, value: String(Math.floor(scan.compositeScore / 50)) });
      else if (scan.compositeScore < 650) add({ code: 'CY_SCAN_SCORE', shortDescription: `CRP posture score ${scan.compositeScore} (grade ${scan.grade})`, longDescription: 'Security posture score below 650 requires review.', blockingPoint: 'Quote', requiredAuthority: 2, value: String(Math.floor(scan.compositeScore / 50)) });
    }
  }

  if (risk.product === 'PROPERTY') {
    const total = risk.buildings.reduce((s, b) => s + tiv(b), 0);
    if (!risk.buildings.length) add({ code: 'PR_NO_BUILDINGS', shortDescription: 'No buildings entered', longDescription: 'At least one building is required to rate.', blockingPoint: 'Quote', requiredAuthority: 3, value: '0' });
    if (total > 25_000_000) add({ code: 'PR_TIV', shortDescription: `TIV ${money(total)} exceeds $25M`, longDescription: 'Large TIV requires facultative/treaty review. Over $50M requires manager approval.', blockingPoint: 'Quote', requiredAuthority: total > 50_000_000 ? 3 : 2, value: String(Math.round(total / 1_000_000)), subjectivity: 'Current (within 3 years) statement of values signed by the insured' });
    for (const b of risk.buildings) {
      const loc = risk.locations.find((l) => l.id === b.locationId);
      const tag = `Loc ${loc?.number ?? '?'} Bldg ${b.number}`;
      if (b.constructionClass === 1 && b.sprinklerPct < 50 && b.squareFeet > 10_000) add({ code: `PR_FRAME_${b.id}`, shortDescription: `${tag}: large unsprinklered frame building`, longDescription: `${b.squareFeet.toLocaleString()} sq ft frame construction with ${b.sprinklerPct}% sprinkler protection.`, blockingPoint: 'Quote', requiredAuthority: 2, value: `${b.squareFeet}/${b.sprinklerPct}` });
      if (loc && loc.protectionClass >= 9) add({ code: `PR_PC_${b.id}`, shortDescription: `${tag}: protection class ${loc.protectionClass}`, longDescription: 'Poor public fire protection.', blockingPoint: 'Quote', requiredAuthority: 2, value: String(loc.protectionClass) });
      if (b.yearBuilt < 1950) add({ code: `PR_AGE_${b.id}`, shortDescription: `${tag}: built ${b.yearBuilt}`, longDescription: 'Pre-1950 construction; confirm electrical, plumbing, HVAC and roof updates.', blockingPoint: 'Bind', requiredAuthority: 1, value: String(b.yearBuilt), subjectivity: `Building updates questionnaire for ${tag}` });
      if (b.roofYear && new Date(today).getFullYear() - b.roofYear > 20) add({ code: `PR_ROOF_${b.id}`, shortDescription: `${tag}: roof over 20 years old`, longDescription: `Roof last replaced ${b.roofYear}. Consider ACV roof settlement.`, blockingPoint: 'Quote', requiredAuthority: 1, value: String(b.roofYear) });
      if (b.occupiedPct < 50) add({ code: `PR_VACANCY_${b.id}`, shortDescription: `${tag}: ${b.occupiedPct}% occupied`, longDescription: 'Vacancy conditions may restrict coverage.', blockingPoint: 'Quote', requiredAuthority: 2, value: String(b.occupiedPct) });
      const occ = b.occupancy;
      if (occ === 'Woodworking / Sawmill' || occ === 'Heavy Manufacturing') add({ code: `PR_OCC_${b.id}`, shortDescription: `${tag}: high-hazard occupancy (${occ})`, longDescription: 'High-hazard occupancy requires loss control survey.', blockingPoint: 'Bind', requiredAuthority: 2, value: occ, subjectivity: `Satisfactory loss control inspection of ${tag} within 30 days of binding` });
    }
    for (const loc of risk.locations) {
      const h = locationHazard(loc);
      const locTiv = risk.buildings.filter((b) => b.locationId === loc.id).reduce((s, b) => s + tiv(b), 0);
      if (h.windTier === 1) add({ code: `PR_WIND_${loc.id}`, shortDescription: `Loc ${loc.number}: Tier 1 wind zone`, longDescription: `${h.distanceToCoastMiles} miles to coast, TIV ${money(locTiv)}. Named-storm deductible recommended.`, blockingPoint: 'Quote', requiredAuthority: risk.coverages.windHailDeductiblePct >= 2 ? 2 : 3, value: `${risk.coverages.windHailDeductiblePct}` });
      if (h.floodZone === 'A' || h.floodZone === 'AE') add({ code: `PR_FLOOD_${loc.id}`, shortDescription: `Loc ${loc.number}: Flood Zone ${h.floodZone}`, longDescription: 'Location in Special Flood Hazard Area; flood is excluded under this form.', blockingPoint: 'Informational', requiredAuthority: 1, value: h.floodZone });
      if (h.quake === 'High' && risk.coverages.earthquake) add({ code: `PR_QUAKE_${loc.id}`, shortDescription: `Loc ${loc.number}: earthquake requested in high seismic zone`, longDescription: 'Earthquake in high seismic zone requires CAT model and manager approval.', blockingPoint: 'Quote', requiredAuthority: 3, value: 'High' });
      if (h.wildfire === 'High') add({ code: `PR_WILDFIRE_${loc.id}`, shortDescription: `Loc ${loc.number}: high wildfire risk`, longDescription: 'Defensible space and roof class must be verified.', blockingPoint: 'Bind', requiredAuthority: 2, value: 'High', subjectivity: `Wildfire mitigation (defensible space, Class A roof) confirmation for Location ${loc.number}` });
    }
  }

  if (risk.product === 'GL') {
    if (!risk.exposures.length) add({ code: 'GL_NO_EXPOSURE', shortDescription: 'No rating exposures entered', longDescription: 'At least one class code exposure is required.', blockingPoint: 'Quote', requiredAuthority: 3, value: '0' });
    for (const e of risk.exposures) {
      const cls = glClass(e.classCode);
      if (!cls) continue;
      if (cls.hazard === 'Prohibited') add({ code: `GL_PROHIBITED_${cls.code}`, shortDescription: `Prohibited class ${cls.code}`, longDescription: `${cls.description} is a prohibited class.`, blockingPoint: 'Quote', requiredAuthority: 4, value: cls.code });
      if (cls.hazard === 'High') add({ code: `GL_HIGH_HAZARD_${cls.code}`, shortDescription: `High hazard class ${cls.code} - ${cls.description}`, longDescription: 'High-hazard operations require senior approval and subcontractor controls.', blockingPoint: 'Quote', requiredAuthority: 2, value: cls.code, subjectivity: 'Copies of subcontractor agreements with hold-harmless and certificates of insurance' });
    }
    const lim = GL_LIMIT_OPTIONS[risk.coverages.limitOption];
    if (lim && lim.occurrence > 1_000_000) add({ code: 'GL_LIMIT', shortDescription: `Limits ${risk.coverages.limitOption} above standard`, longDescription: 'Occurrence limits above $1M require senior approval.', blockingPoint: 'Quote', requiredAuthority: 2, value: risk.coverages.limitOption });
    const severe = [...new Set(risk.locations.filter((l) => LITIGATION_ENVIRONMENT[l.state] === 'Severe').map((l) => l.state))];
    if (severe.length) add({ code: 'GL_LITIGATION', shortDescription: `Severe litigation venue: ${severe.join(', ')}`, longDescription: 'Operations in severe litigation environments; consider limit and pricing adequacy.', blockingPoint: 'Informational', requiredAuthority: 1, value: severe.join(',') });
    if (scan && scan.product === 'GL') {
      const f = scan.sections.flatMap((s) => s.findings);
      if (f.some((x) => x.code === 'RECALL')) add({ code: 'GL_RECALL', shortDescription: 'CRP scan: product recall on record', longDescription: 'Obtain recall details and corrective action.', blockingPoint: 'Quote', requiredAuthority: 2, value: 'recall' });
      if (f.some((x) => x.code === 'OSHA' && x.severity === 'High')) add({ code: 'GL_OSHA', shortDescription: 'CRP scan: repeated OSHA citations', longDescription: 'Three or more OSHA citations in 5 years; obtain safety program.', blockingPoint: 'Bind', requiredAuthority: 1, value: 'osha', subjectivity: 'Copy of written safety program and OSHA abatement documentation' });
    }
    if (account.state && !risk.locations.some((l) => l.state === account.state)) add({ code: 'GL_NO_HQ_LOCATION', shortDescription: 'Mailing state not among locations', longDescription: 'The insured mailing address state is not a scheduled location.', blockingPoint: 'Informational', requiredAuthority: 1, value: account.state });
  }

  return out;
}

/** Standard subjectivities always included on a quote. */
export function standardSubjectivities(product: RiskData['product']): string[] {
  const base = ['Signed and dated application within 30 days of the effective date'];
  if (product === 'CYBER') base.push('Completed ransomware supplemental application');
  if (product === 'PROPERTY') base.push('Signed statement of values');
  if (product === 'GL') base.push('Confirmation of rating exposures (sales/payroll/area) for the policy period');
  return base;
}

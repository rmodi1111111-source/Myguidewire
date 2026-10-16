import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, fmtDate, money, type RiskData, type SubmissionDetail } from '../api';
import { Button, Messages, Modal, StatusBadge, Toolbar } from '../components/ui';
import { useApp } from '../context';
import { pushRecent } from '../recent';
import Summary from './steps/Summary';
import Clearance from './steps/Clearance';
import PolicyInfo from './steps/PolicyInfo';
import CyberQualification from './steps/CyberQualification';
import CyberExposure from './steps/CyberExposure';
import CyberCoverages from './steps/CyberCoverages';
import Locations from './steps/Locations';
import Buildings from './steps/Buildings';
import PropertyCoverages from './steps/PropertyCoverages';
import GLExposures from './steps/GLExposures';
import GLCoverages from './steps/GLCoverages';
import LossHistory from './steps/LossHistory';
import RiskAnalysis from './steps/RiskAnalysis';
import Pricing from './steps/Pricing';
import QuoteStep from './steps/QuoteStep';
import { Documents, History, Notes, Activities } from './steps/Tools';
import { CancellationStep, PaymentStep, PolicyReviewStep, ReinstatementStep } from './steps/BindSteps';

export interface StepProps {
  detail: SubmissionDetail;
  risk: RiskData;
  setRisk: (r: RiskData) => void;
  editable: boolean;
  /** POST/PUT an action that returns the refreshed submission detail. */
  act: (path: string, body?: unknown, method?: string) => Promise<boolean>;
  setDetail: (d: SubmissionDetail) => void;
  save: () => Promise<boolean>;
}

const STEP_COMPONENTS: Record<string, (p: StepProps) => JSX.Element> = {
  summary: Summary,
  clearance: Clearance,
  'policy-info': PolicyInfo,
  qualification: CyberQualification,
  exposure: CyberExposure,
  locations: Locations,
  buildings: Buildings,
  exposures: GLExposures,
  losses: LossHistory,
  'risk-analysis': RiskAnalysis,
  pricing: Pricing,
  quote: QuoteStep,
  payment: PaymentStep,
  'policy-review': PolicyReviewStep,
  cancellation: CancellationStep,
  reinstatement: ReinstatementStep,
  documents: Documents,
  notes: Notes,
  activities: Activities,
  history: History,
};

function coverageComponent(product: string) {
  return product === 'CYBER' ? CyberCoverages : product === 'PROPERTY' ? PropertyCoverages : GLCoverages;
}

export default function SubmissionPage() {
  const { ref, user } = useApp();
  const params = useParams();
  const id = Number(params.id);
  const step = params['*'] || 'summary';
  const nav = useNavigate();
  const [detail, setDetailState] = useState<SubmissionDetail | null>(null);
  const [risk, setRiskState] = useState<RiskData | null>(null);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [infos, setInfos] = useState<string[]>([]);
  const [closeDialog, setCloseDialog] = useState<'decline' | 'withdraw' | 'nonrenew' | null>(null);
  const [bindMenu, setBindMenu] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const setDetail = useCallback((d: SubmissionDetail) => {
    setDetailState(d);
    const v = d.versions.find((x) => x.id === d.selectedVersionId) ?? d.versions[0];
    setRiskState(structuredClone(v.risk));
    setDirty(false);
  }, []);

  useEffect(() => {
    api<SubmissionDetail>(`/submissions/${id}`).then((d) => {
      setDetail(d);
      pushRecent('submissions', { id: d.submission.id, label: `${d.submission.jobNumber} ${d.account.name}` });
    }).catch((e) => setErrors([e.message]));
  }, [id, setDetail]);

  const handleError = (e: unknown) => {
    if (e instanceof ApiError) {
      const det = Array.isArray(e.details) ? e.details.map((x: any) => (typeof x === 'string' ? x : `${x.level === 'warning' ? 'Warning' : 'Error'}: ${x.message}`)) : [];
      setErrors([e.message, ...det]);
    } else setErrors([String((e as Error)?.message ?? e)]);
  };

  const save = useCallback(async (): Promise<boolean> => {
    if (!dirty || !detail || !risk) return true;
    try {
      const d = await api<SubmissionDetail>(`/submissions/${id}/versions/${detail.selectedVersionId}/risk`, { method: 'PUT', body: risk });
      setDetail(d);
      return true;
    } catch (e) {
      handleError(e);
      return false;
    }
  }, [dirty, detail, risk, id, setDetail]);

  const act = useCallback(async (path: string, body?: unknown, method = 'POST'): Promise<boolean> => {
    setBusy(true);
    setErrors([]);
    setInfos([]);
    try {
      const d = await api<SubmissionDetail>(`/submissions/${id}${path}`, { method, body: body ?? {} });
      setDetail(d);
      return true;
    } catch (e) {
      handleError(e);
      return false;
    } finally {
      setBusy(false);
    }
  }, [id, setDetail]);

  if (!detail || !risk) return <div className="content-pad"><Messages errors={errors.length ? errors : []} infos={errors.length ? [] : ['Loading...']} /></div>;

  const { submission: sub, account } = detail;
  const product = ref.products[sub.product];
  const jobType = sub.jobType;
  const editable = sub.status === 'DRAFT' || sub.status === 'RATED';
  const preClearance = jobType === 'Submission' && (sub.status === 'INTAKE' || sub.status === 'CLEARANCE_REFERRAL');
  const closed = sub.status === 'DECLINED' || sub.status === 'WITHDRAWN' || sub.status === 'NON_RENEWED';
  const bound = sub.status === 'BOUND';
  const version = detail.versions.find((v) => v.id === detail.selectedVersionId)!;

  // Wizard steps per job type, as in the PolicyCenter job wizards.
  const wizard: { key: string; label: string }[] =
    jobType === 'Cancellation' ? [{ key: 'summary', label: 'Summary' }, { key: 'cancellation', label: 'Cancellation' }]
      : jobType === 'Reinstatement' ? [{ key: 'summary', label: 'Summary' }, { key: 'reinstatement', label: 'Reinstatement' }]
        : jobType === 'PolicyChange' ? [
          { key: 'summary', label: 'Summary' }, { key: 'policy-info', label: 'Policy Info' }, ...product.riskSteps,
          { key: 'risk-analysis', label: 'Risk Analysis' }, { key: 'pricing', label: 'Pricing' }, { key: 'policy-review', label: 'Policy Review' },
        ]
          : [
            { key: 'summary', label: 'Summary' },
            ...(jobType === 'Submission' ? [{ key: 'clearance', label: 'Clearance' }] : []),
            { key: 'policy-info', label: 'Policy Info' }, ...product.riskSteps, { key: 'losses', label: 'Loss History' },
            { key: 'risk-analysis', label: 'Risk Analysis' }, { key: 'pricing', label: 'Pricing' }, { key: 'quote', label: 'Quote' }, { key: 'payment', label: 'Payment' },
          ];
  const finalStep = wizard[wizard.length - 1].key;
  const tools = [
    { key: 'documents', label: `Documents (${detail.documents.length})` },
    { key: 'notes', label: `Notes (${detail.notes.length})` },
    { key: 'activities', label: `Activities (${detail.activities.filter((a) => a.status === 'Open').length})` },
    { key: 'history', label: 'History' },
  ];
  const idx = wizard.findIndex((w) => w.key === step);
  const goto = async (key: string) => {
    if (dirty && !(await save())) return;
    setErrors([]);
    setInfos([]);
    nav(`/submissions/${id}/${key}`);
  };

  const setRisk = (r: RiskData) => {
    setRiskState(r);
    setDirty(true);
  };

  const quote = async () => {
    if (!(await save())) return;
    if (await act('/rate')) nav(`/submissions/${id}/pricing`);
    else nav(`/submissions/${id}/pricing`);
  };

  const validationForStep = detail.validation.filter((v) => v.step === step && v.level === 'error').map((v) => v.message);
  const Comp = step === 'coverages' ? coverageComponent(sub.product) : STEP_COMPONENTS[step] ?? Summary;
  const premium = version.pricing?.premium;

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-title">{product.name} {detail.jobTypeLabel}</div>
        <ul className="side-nav wizard">
          {wizard.map((w, i) => {
            const locked = preClearance && i > 1;
            const hasErr = detail.validation.some((v) => v.step === w.key && v.level === 'error');
            return (
              <li key={w.key} className={`${step === w.key ? 'active' : ''}${locked ? ' locked' : ''}`} onClick={() => !locked && goto(w.key)} title={locked ? 'Complete clearance first' : undefined}>
                {w.label}
                {hasErr && editable && <span className="dot-err" title="Has validation errors" />}
              </li>
            );
          })}
        </ul>
        <div className="sidebar-title">Tools</div>
        <ul className="side-nav">
          {tools.map((t) => (
            <li key={t.key} className={step === t.key ? 'active' : ''} onClick={() => goto(t.key)}>{t.label}</li>
          ))}
        </ul>
      </aside>
      <div className="content">
        <div className="info-bar">
          <span><b>Account</b> <Link to={`/accounts/${account.id}`}>{account.name}</Link></span>
          <span><b>{detail.jobTypeLabel}</b> {sub.jobNumber}</span>
          {detail.policy && <span><b>Policy</b> <Link to={`/policies/${detail.policy.id}`}>{detail.policy.policyNumber}</Link></span>}
          <span><b>Product</b> {product.name}</span>
          <span><b>Status</b> <StatusBadge status={sub.status} label={sub.statusLabel} /></span>
          <span><b>Effective</b> {fmtDate(sub.effectiveDate)}</span>
          <span><b>Producer</b> {detail.producer.name}</span>
          <span><b>UW</b> {detail.underwriter?.name ?? 'Unassigned'}</span>
          {detail.versions.length > 1 && <span><b>Version</b> {version.name}</span>}
          {jobType === 'Submission' || jobType === 'Renewal'
            ? <span><b>Premium</b> {money(premium)}</span>
            : <span><b>Transaction Premium</b> {money(detail.premiumSummary?.transactionPremium)}</span>}
        </div>
        <div className="page-head">
          <h1>{[...wizard, ...tools].find((w) => w.key === step)?.label.replace(/ \(\d+\)$/, '') ?? 'Summary'}</h1>
          <Toolbar>
            {idx > 0 && <Button onClick={() => goto(wizard[idx - 1].key)}>&lt; Back</Button>}
            {idx >= 0 && idx < wizard.length - 1 && !(preClearance && idx >= 1) && <Button onClick={() => goto(wizard[idx + 1].key)}>Next &gt;</Button>}
            {editable && dirty && <Button onClick={save}>Save Draft</Button>}
            {editable && <Button primary onClick={quote} disabled={busy}>{sub.status === 'RATED' && !dirty ? 'Re-Rate' : 'Rate'}</Button>}
            {sub.status === 'QUOTED' && jobType !== 'Cancellation' && jobType !== 'Reinstatement' && <Button onClick={() => act('/edit-quote')} disabled={user.authorityLevel < 1}>Edit Quote</Button>}
            {!closed && !bound && <Button onClick={() => { setReason(''); setCloseDialog('withdraw'); }}>Withdraw</Button>}
            {!closed && !bound && jobType === 'Submission' && user.authorityLevel >= 1 && <Button danger onClick={() => { setReason(''); setCloseDialog('decline'); }}>Decline</Button>}
            {!closed && !bound && jobType === 'Renewal' && <Button danger disabled={user.authorityLevel < 2} title={user.authorityLevel < 2 ? 'Requires authority 2' : undefined} onClick={() => { setReason(''); setCloseDialog('nonrenew'); }}>Non-Renew</Button>}
            {closed && jobType === 'Submission' && <Button onClick={() => act('/reopen')} disabled={user.authorityLevel < 2} title={user.authorityLevel < 2 ? 'Requires authority 2' : undefined}>Reopen</Button>}
            {!closed && !bound && (
              <span className="menu-wrap">
                <Button primary={sub.status === 'QUOTED'} disabled={sub.status !== 'QUOTED'} title={sub.status !== 'QUOTED' ? 'Quote first' : undefined} onClick={() => setBindMenu(!bindMenu)}>
                  Bind Options &#9662;
                </Button>
                {bindMenu && (
                  <div className="dropdown right" onMouseLeave={() => setBindMenu(false)}>
                    {(jobType === 'Submission' ? [['Bind Only', false], ['Issue Policy', true]] as const
                      : jobType === 'Renewal' ? [['Issue Renewal', true]] as const
                        : jobType === 'PolicyChange' ? [['Issue Policy Change', true]] as const
                          : jobType === 'Cancellation' ? [['Bind Cancellation', true]] as const
                            : [['Reinstate Policy', true]] as const
                    ).map(([labelText, issue]) => (
                      <button key={labelText} className="dropdown-item" onClick={async () => {
                        setBindMenu(false);
                        if (!(await save())) return;
                        if (!(await act('/bind', { issue }))) nav(`/submissions/${id}/${finalStep}`);
                      }}>{labelText}</button>
                    ))}
                    {(jobType === 'Submission' || jobType === 'Renewal') && <button className="dropdown-item" onClick={() => { setBindMenu(false); goto('payment'); }}>Review payment & subjectivities...</button>}
                  </div>
                )}
              </span>
            )}
            {bound && detail.policy && <Link className="btn btn-primary" to={`/policies/${detail.policy.id}`}>Go to Policy {detail.policy.policyNumber}</Link>}
          </Toolbar>
        </div>
        <Messages
          errors={errors}
          warnings={[
            ...(dirty ? ['You have unsaved changes.'] : []),
            ...(editable ? validationForStep : []),
            ...(sub.status === 'QUOTED' && !['quote', 'payment', 'policy-review', 'cancellation', 'reinstatement'].includes(step) && jobType !== 'Cancellation' && jobType !== 'Reinstatement' ? ['This transaction is quoted and read-only. Use Edit Quote to make changes, or Bind Options to bind it.'] : []),
          ]}
          infos={[
            ...infos,
            ...(closed ? [`${sub.statusLabel}: ${sub.declineReason ?? ''}`] : []),
            ...(bound && detail.policy ? [`Bound on policy ${detail.policy.policyNumber}. This transaction is read-only; use the policy file for further changes.`] : []),
            ...(preClearance && step !== 'clearance' && step !== 'summary' ? ['Risk entry is available once the submission clears.'] : []),
          ]}
        />
        <Comp detail={detail} risk={risk} setRisk={setRisk} editable={editable} act={act} setDetail={setDetail} save={save} />
      </div>
      {closeDialog && (
        <Modal
          title={closeDialog === 'decline' ? 'Decline Submission' : closeDialog === 'nonrenew' ? 'Non-Renew Policy' : `Withdraw ${detail.jobTypeLabel}`}
          onClose={() => setCloseDialog(null)}
          footer={
            <>
              <Button onClick={() => setCloseDialog(null)}>Cancel</Button>
              <Button primary danger={closeDialog !== 'withdraw'} onClick={async () => { if (await act(`/${closeDialog === 'nonrenew' ? 'non-renew' : closeDialog}`, { reason })) setCloseDialog(null); }}>
                {closeDialog === 'decline' ? 'Decline' : closeDialog === 'nonrenew' ? 'Non-Renew' : 'Withdraw'}
              </Button>
            </>
          }
        >
          <p>{closeDialog === 'decline' ? 'Declining closes the submission and supersedes any quote. A reason is required and will be communicated to the producer.'
            : closeDialog === 'nonrenew' ? 'The policy will expire at the end of the current term. A non-renewal notice is generated for the insured and producer.'
              : jobType === 'Submission' ? 'Record that the producer withdrew this submission.' : 'Withdraw this transaction. The policy is not changed.'}</p>
          <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">{'<select a reason>'}</option>
            {(closeDialog === 'decline'
              ? ['Outside appetite - class of business', 'Inadequate security controls', 'Adverse loss history', 'CAT exposure exceeds capacity', 'Insufficient information', 'Pricing inadequate for exposure', 'Sanctions / compliance']
              : closeDialog === 'nonrenew'
                ? ['Adverse loss experience', 'Change in underwriting guidelines', 'Deterioration of security controls', 'CAT exposure management', 'Producer agreement terminated']
                : jobType === 'Submission'
                  ? ['Placed with another carrier', 'Insured renewed with incumbent', 'Price not competitive', 'Coverage not competitive', 'Insured no longer needs coverage']
                  : ['Entered in error', 'Insured changed request', 'Superseded by another transaction']
            ).map((r) => <option key={r}>{r}</option>)}
          </select>
          <textarea className="input textarea" placeholder="Additional comments" onChange={(e) => setReason((r) => r.split(' - ')[0] + (e.target.value ? ` - ${e.target.value}` : ''))} />
        </Modal>
      )}
    </div>
  );
}

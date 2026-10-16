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
  const [closeDialog, setCloseDialog] = useState<'decline' | 'withdraw' | null>(null);
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
  const editable = sub.status === 'DRAFT' || sub.status === 'RATED';
  const preClearance = sub.status === 'INTAKE' || sub.status === 'CLEARANCE_REFERRAL';
  const closed = sub.status === 'DECLINED' || sub.status === 'WITHDRAWN';
  const version = detail.versions.find((v) => v.id === detail.selectedVersionId)!;

  const wizard: { key: string; label: string }[] = [
    { key: 'summary', label: 'Summary' },
    { key: 'clearance', label: 'Clearance' },
    { key: 'policy-info', label: 'Policy Info' },
    ...product.riskSteps,
    { key: 'losses', label: 'Loss History' },
    { key: 'risk-analysis', label: 'Risk Analysis' },
    { key: 'pricing', label: 'Pricing' },
    { key: 'quote', label: 'Quote' },
  ];
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
        <div className="sidebar-title">{product.name} Submission</div>
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
          <span><b>Submission</b> {sub.jobNumber}</span>
          <span><b>Product</b> {product.name}</span>
          <span><b>Status</b> <StatusBadge status={sub.status} label={sub.statusLabel} /></span>
          <span><b>Effective</b> {fmtDate(sub.effectiveDate)}</span>
          <span><b>Producer</b> {detail.producer.name}</span>
          <span><b>UW</b> {detail.underwriter?.name ?? 'Unassigned'}</span>
          {detail.versions.length > 1 && <span><b>Version</b> {version.name}</span>}
          <span><b>Premium</b> {money(premium)}</span>
        </div>
        <div className="page-head">
          <h1>{[...wizard, ...tools].find((w) => w.key === step)?.label.replace(/ \(\d+\)$/, '') ?? 'Summary'}</h1>
          <Toolbar>
            {idx > 0 && <Button onClick={() => goto(wizard[idx - 1].key)}>&lt; Back</Button>}
            {idx >= 0 && idx < wizard.length - 1 && !(preClearance && idx >= 1) && <Button onClick={() => goto(wizard[idx + 1].key)}>Next &gt;</Button>}
            {editable && dirty && <Button onClick={save}>Save Draft</Button>}
            {editable && <Button primary onClick={quote} disabled={busy}>{sub.status === 'RATED' && !dirty ? 'Re-Rate' : 'Rate'}</Button>}
            {sub.status === 'QUOTED' && <Button onClick={() => act('/edit-quote')} disabled={user.authorityLevel < 1}>Edit Quote</Button>}
            {!closed && <Button onClick={() => { setReason(''); setCloseDialog('withdraw'); }}>Withdraw</Button>}
            {!closed && user.authorityLevel >= 1 && <Button danger onClick={() => { setReason(''); setCloseDialog('decline'); }}>Decline</Button>}
            {closed && <Button onClick={() => act('/reopen')} disabled={user.authorityLevel < 2} title={user.authorityLevel < 2 ? 'Requires authority 2' : undefined}>Reopen</Button>}
            <Button disabled title="Bind is outside the scope of this pre-bind workbench">Bind Options</Button>
          </Toolbar>
        </div>
        <Messages
          errors={errors}
          warnings={[
            ...(dirty ? ['You have unsaved changes.'] : []),
            ...(editable ? validationForStep : []),
            ...(sub.status === 'QUOTED' && step !== 'quote' ? ['This submission is quoted and read-only. Use Edit Quote to make changes (the current quote will be superseded).'] : []),
          ]}
          infos={[
            ...infos,
            ...(closed ? [`${sub.statusLabel}: ${sub.declineReason ?? ''}`] : []),
            ...(preClearance && step !== 'clearance' && step !== 'summary' ? ['Risk entry is available once the submission clears.'] : []),
          ]}
        />
        <Comp detail={detail} risk={risk} setRisk={setRisk} editable={editable} act={act} setDetail={setDetail} save={save} />
      </div>
      {closeDialog && (
        <Modal
          title={closeDialog === 'decline' ? 'Decline Submission' : 'Withdraw Submission'}
          onClose={() => setCloseDialog(null)}
          footer={
            <>
              <Button onClick={() => setCloseDialog(null)}>Cancel</Button>
              <Button primary danger={closeDialog === 'decline'} onClick={async () => { if (await act(`/${closeDialog}`, { reason })) setCloseDialog(null); }}>
                {closeDialog === 'decline' ? 'Decline' : 'Withdraw'}
              </Button>
            </>
          }
        >
          <p>{closeDialog === 'decline' ? 'Declining closes the submission and supersedes any quote. A reason is required and will be communicated to the producer.' : 'Record that the producer withdrew this submission.'}</p>
          <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">{'<select a reason>'}</option>
            {(closeDialog === 'decline'
              ? ['Outside appetite - class of business', 'Inadequate security controls', 'Adverse loss history', 'CAT exposure exceeds capacity', 'Insufficient information', 'Pricing inadequate for exposure', 'Sanctions / compliance']
              : ['Placed with another carrier', 'Insured renewed with incumbent', 'Price not competitive', 'Coverage not competitive', 'Insured no longer needs coverage']
            ).map((r) => <option key={r}>{r}</option>)}
          </select>
          <textarea className="input textarea" placeholder="Additional comments" onChange={(e) => setReason((r) => r.split(' - ')[0] + (e.target.value ? ` - ${e.target.value}` : ''))} />
        </Modal>
      )}
    </div>
  );
}

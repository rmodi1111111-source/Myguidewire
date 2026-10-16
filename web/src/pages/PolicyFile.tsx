import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, STATUS_TEXT, api, fmtDate, fmtDateTime, money, policyBadge, type PolicyDetail, type PolicyPeriod, type SubmissionDetail } from '../api';
import CoverageSchedule from '../components/CoverageSchedule';
import { Button, Empty, FieldRow, Messages, Modal, Panel, Select, StatusBadge, Tabs, TextInput, Toolbar } from '../components/ui';
import { useApp } from '../context';
import { pushRecent } from '../recent';
import CyberQualification from './steps/CyberQualification';
import CyberExposure from './steps/CyberExposure';
import Locations from './steps/Locations';
import Buildings from './steps/Buildings';
import GLExposures from './steps/GLExposures';
import LossHistory from './steps/LossHistory';
import type { StepProps } from './SubmissionPage';

type Dialog = 'change' | 'cancel' | 'reinstate' | 'renew' | null;

const STEPS = [
  { key: 'summary', label: 'Summary' },
  { key: 'contract', label: 'Policy Contract' },
  { key: 'risk', label: 'Risk Details' },
  { key: 'transactions', label: 'Transactions' },
  { key: 'billing', label: 'Billing' },
  { key: 'documents', label: 'Documents' },
  { key: 'history', label: 'History' },
];

const today = () => new Date().toISOString().slice(0, 10);

export default function PolicyFile() {
  const { user } = useApp();
  const params = useParams();
  const id = Number(params.id);
  const step = params['*'] || 'summary';
  const nav = useNavigate();
  const [d, setD] = useState<PolicyDetail | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [asOf, setAsOf] = useState<number | null>(null);

  const load = () =>
    api<PolicyDetail>(`/policies/${id}`).then((x) => {
      setD(x);
      pushRecent('policies', { id: x.policy.id, label: `${x.policy.policyNumber} ${x.account.name}` });
    }).catch((e) => setErrors([e.message]));
  useEffect(() => {
    load();
    setAsOf(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const start = async (path: string, body: unknown) => {
    setErrors([]);
    try {
      const r = await api<{ jobId: number }>(`/policies/${id}/${path}`, { body });
      setDialog(null);
      const landing: Record<string, string> = { change: 'policy-info', cancel: 'cancellation', reinstate: 'reinstatement', renew: 'summary' };
      nav(`/submissions/${r.jobId}/${landing[path]}`);
    } catch (e) {
      setErrors([e instanceof ApiError ? e.message : String(e)]);
      setDialog(null);
    }
  };

  if (!d) return <div className="content-pad"><Messages errors={errors} infos={errors.length ? [] : ['Loading...']} /></div>;

  const status = d.summary.status;
  const period = d.periods.find((p) => p.id === asOf) ?? d.currentPeriod;
  const canceled = status === 'Canceled' || status === 'Pending Cancellation';
  const open = d.openTransactions.length > 0;
  const uw = user.authorityLevel >= 1;

  const actions: { label: string; onClick: () => void; disabled?: string }[] = [
    { label: 'Change Policy', onClick: () => setDialog('change'), disabled: !uw ? 'Underwriters only' : canceled ? 'Policy is canceled' : open ? 'Another transaction is open' : undefined },
    { label: 'Cancel Policy', onClick: () => setDialog('cancel'), disabled: !uw ? 'Underwriters only' : canceled ? 'Already canceled' : open ? 'Another transaction is open' : undefined },
    { label: 'Reinstate Policy', onClick: () => setDialog('reinstate'), disabled: !canceled ? 'Policy is not canceled' : user.authorityLevel < 2 ? 'Requires authority 2' : open ? 'Another transaction is open' : undefined },
    { label: 'Renew Policy', onClick: () => setDialog('renew'), disabled: !uw ? 'Underwriters only' : canceled ? 'Policy is canceled' : d.policy.nonRenewalReason ? 'Non-renewed' : d.renewal ? `Renewal ${d.renewal.jobNumber} exists` : !d.renewalWindowOpen ? 'Opens 120 days before expiration' : undefined },
  ];
  if (status === 'Bound - Pending Issuance') actions.unshift({ label: 'Issue Policy', onClick: async () => { try { setD(await api(`/policies/${id}/issue`, { body: {} })); } catch (e: any) { setErrors([e.message]); } } });

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-title">Actions</div>
        <ul className="side-nav actions">
          {actions.map((a) => (
            <li key={a.label} className={a.disabled ? 'locked' : ''} title={a.disabled} onClick={() => !a.disabled && a.onClick()}>{a.label}</li>
          ))}
        </ul>
        <div className="sidebar-title">Policy File</div>
        <ul className="side-nav">
          {STEPS.map((s) => <li key={s.key} className={step === s.key ? 'active' : ''} onClick={() => nav(`/policies/${id}/${s.key}`)}>{s.label}</li>)}
        </ul>
      </aside>
      <div className="content">
        <div className="info-bar">
          <span><b>Policy</b> {d.policy.policyNumber}</span>
          <span><b>Status</b> <StatusBadge status={policyBadge(status)} label={status} /></span>
          <span><b>Account</b> <Link to={`/accounts/${d.account.id}`}>{d.account.name}</Link></span>
          <span><b>Product</b> {d.summary.productName}</span>
          <span><b>Term</b> {fmtDate(d.currentPeriod.periodStart)} - {fmtDate(d.currentPeriod.periodEnd)}</span>
          <span><b>Term Premium</b> {money(d.currentPeriod.termPremium)}</span>
          <span><b>Producer</b> {d.producer.name}</span>
        </div>
        <div className="page-head">
          <h1>Policy File: {STEPS.find((s) => s.key === step)?.label}</h1>
          {(step === 'contract' || step === 'risk') && (
            <Toolbar>
              <span className="muted">View as of</span>
              <Select value={period.id} onChange={(v) => setAsOf(v)} options={d.periods.map((p) => ({ value: p.id, label: `Term ${p.termNumber} model ${p.modelNumber} - eff ${fmtDate(p.editEffectiveDate)}${p.status === 'Superseded' ? ' (superseded)' : ''}` }))} />
            </Toolbar>
          )}
        </div>
        <Messages
          errors={errors}
          infos={[
            ...d.openTransactions.map((t) => `Open transaction: ${t.jobTypeLabel} ${t.jobNumber} (${STATUS_TEXT[t.status] ?? t.status})`),
            ...(d.policy.nonRenewalReason ? [`Non-renewed: ${d.policy.nonRenewalReason}. The policy expires ${fmtDate(d.currentPeriod.periodEnd)}.`] : []),
          ]}
        />
        {d.openTransactions.length > 0 && (
          <Toolbar>{d.openTransactions.map((t) => <Link key={t.id} className="btn" to={`/submissions/${t.id}`}>Go to {t.jobTypeLabel} {t.jobNumber}</Link>)}</Toolbar>
        )}

        {step === 'summary' && <Summary d={d} />}
        {step === 'contract' && (
          <>
            <Panel title={`Coverage as of term ${period.termNumber}, model ${period.modelNumber}`}>
              <CoverageSchedule risk={period.risk} />
            </Panel>
            <Panel title="Premium">
              <PremiumLines period={period} />
            </Panel>
          </>
        )}
        {step === 'risk' && <RiskView d={d} period={period} />}
        {step === 'transactions' && <Transactions d={d} />}
        {step === 'billing' && <Billing d={d} reload={load} setErrors={setErrors} />}
        {step === 'documents' && (
          <Panel title="Policy Documents">
            {!d.documents.length ? <Empty>No documents.</Empty> : (
              <table className="list">
                <thead><tr><th>Document</th><th>Type</th><th>Transaction</th><th>Created</th></tr></thead>
                <tbody>
                  {d.documents.map((x) => (
                    <tr key={x.id}>
                      <td><Link to={`/documents/${x.id}`}>{x.name}</Link></td>
                      <td>{x.docType}</td>
                      <td>{d.transactions.find((t) => t.id === x.jobId)?.jobNumber ?? '-'}</td>
                      <td>{fmtDateTime(x.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        )}
        {step === 'history' && (
          <Panel title="History">
            <table className="list">
              <thead><tr><th>Date</th><th>Transaction</th><th>Event</th><th>Detail</th><th>User</th></tr></thead>
              <tbody>{d.history.map((h) => <tr key={h.id}><td>{fmtDateTime(h.created_at)}</td><td>{h.jobNumber}</td><td>{h.event}</td><td>{h.detail}</td><td>{h.user_name}</td></tr>)}</tbody>
            </table>
          </Panel>
        )}
      </div>

      {dialog === 'change' && <ChangeDialog d={d} onClose={() => setDialog(null)} onStart={(b) => start('change', b)} />}
      {dialog === 'cancel' && <CancelDialog d={d} onClose={() => setDialog(null)} onStart={(b) => start('cancel', b)} />}
      {dialog === 'reinstate' && <ReinstateDialog d={d} onClose={() => setDialog(null)} onStart={(b) => start('reinstate', b)} />}
      {dialog === 'renew' && (
        <Modal title="Renew Policy" onClose={() => setDialog(null)} footer={<><Button onClick={() => setDialog(null)}>Cancel</Button><Button primary onClick={() => start('renew', {})}>Start Renewal</Button></>}>
          <p>Start the renewal of term {d.currentPeriod.termNumber} for {d.policy.policyNumber}. The renewal term runs {fmtDate(d.currentPeriod.periodEnd)} to one year later.</p>
          <p>Risk details, coverages and loss history are copied from the current term. Review the exposures, run a fresh CRP scan, re-rate and quote the renewal before issuing it.</p>
        </Modal>
      )}
    </div>
  );
}

function Summary({ d }: { d: PolicyDetail }) {
  const p = d.currentPeriod;
  const terms = d.periods.filter((x) => x.status === 'Current');
  return (
    <>
      <div className="grid-2">
        <Panel title="Policy">
          <FieldRow label="Policy Number">{d.policy.policyNumber}</FieldRow>
          <FieldRow label="Status"><StatusBadge status={policyBadge(d.summary.status)} label={d.summary.status} /></FieldRow>
          <FieldRow label="Product">{d.summary.productName}</FieldRow>
          <FieldRow label="Original Effective">{fmtDate(d.policy.originalEffectiveDate)}</FieldRow>
          <FieldRow label="Current Term">Term {p.termNumber}: {fmtDate(p.periodStart)} - {fmtDate(p.periodEnd)}</FieldRow>
          {p.cancellationDate && <FieldRow label="Cancellation Date">{fmtDate(p.cancellationDate)}</FieldRow>}
          <FieldRow label="Annual Premium">{money(p.pricing.premium)}</FieldRow>
          <FieldRow label="Term Written Premium">{money(p.termPremium)}</FieldRow>
          <FieldRow label="Renewal">{d.renewal ? <Link to={`/submissions/${d.renewal.id}`}>{d.renewal.jobNumber} ({STATUS_TEXT[d.renewal.status] ?? d.renewal.status})</Link> : d.policy.nonRenewalReason ? 'Non-renewed' : d.renewalWindowOpen ? 'Due - use Renew Policy' : 'Not yet due'}</FieldRow>
        </Panel>
        <Panel title="Parties">
          <FieldRow label="Named Insured"><Link to={`/accounts/${d.account.id}`}>{d.account.name}</Link></FieldRow>
          <FieldRow label="Address">{d.account.address1}, {d.account.city}, {d.account.state} {d.account.zip}</FieldRow>
          <FieldRow label="Producer">{d.producer.code} - {d.producer.name}</FieldRow>
          <FieldRow label="Underwriter">{d.underwriter?.name ?? '-'}</FieldRow>
          <FieldRow label="Payment Plan">{d.billing.paymentPlan}, {d.billing.billingMethod}</FieldRow>
          <FieldRow label="Outstanding">{money(d.billing.outstanding)}</FieldRow>
        </Panel>
      </div>
      <Panel title="Terms">
        <table className="list">
          <thead><tr><th>Term</th><th>Period</th><th>Latest Model</th><th className="r">Annual Premium</th><th className="r">Written Premium</th><th>Status</th></tr></thead>
          <tbody>
            {terms.map((t) => (
              <tr key={t.id}>
                <td>{t.termNumber}</td><td>{fmtDate(t.periodStart)} - {fmtDate(t.periodEnd)}</td><td>{t.modelNumber}</td>
                <td className="r">{money(t.pricing.premium)}</td><td className="r">{money(t.termPremium)}</td>
                <td>{t.cancellationDate ? `Canceled ${fmtDate(t.cancellationDate)}` : !t.issued ? 'Bound, not issued' : t.periodEnd <= today() ? 'Expired' : t.periodStart > today() ? 'Scheduled' : 'In Force'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Transactions d={d} />
    </>
  );
}

function PremiumLines({ period }: { period: PolicyPeriod }) {
  const pr = period.pricing;
  return (
    <table className="list">
      <tbody>
        {pr.lines.map((l) => <tr key={l.coverage}><td>{l.coverage}</td><td className="r">{money(l.premium)}</td></tr>)}
        <tr className="total"><td>Annual Premium</td><td className="r">{money(pr.premium)}</td></tr>
        <tr><td>Transaction premium (this model)</td><td className="r">{money(period.transactionPremium)}</td></tr>
        <tr className="total grand"><td>Written premium for the term</td><td className="r">{money(period.termPremium)}</td></tr>
      </tbody>
    </table>
  );
}

function RiskView({ d, period }: { d: PolicyDetail; period: PolicyPeriod }) {
  const r = period.risk;
  const tabs = r.product === 'CYBER'
    ? [{ key: 'qualification', label: 'Qualification' }, { key: 'exposure', label: 'Exposure & Data' }, { key: 'losses', label: 'Loss History' }]
    : r.product === 'PROPERTY'
      ? [{ key: 'locations', label: 'Locations' }, { key: 'buildings', label: 'Buildings' }, { key: 'losses', label: 'Loss History' }]
      : [{ key: 'locations', label: 'Locations' }, { key: 'exposures', label: 'Exposures' }, { key: 'losses', label: 'Loss History' }];
  const [tab, setTab] = useState(tabs[0].key);
  // Step components are reused read-only; they only read account state and product from the detail.
  const props = useMemo(() => ({
    detail: { account: d.account, submission: { product: r.product } } as unknown as SubmissionDetail,
    risk: r, setRisk: () => undefined, editable: false, act: async () => false, setDetail: () => undefined, save: async () => true,
  }) satisfies StepProps, [d.account, r]);
  return (
    <>
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      {tab === 'qualification' && <CyberQualification {...props} />}
      {tab === 'exposure' && <CyberExposure {...props} />}
      {tab === 'locations' && <Locations {...props} />}
      {tab === 'buildings' && <Buildings {...props} />}
      {tab === 'exposures' && <GLExposures {...props} />}
      {tab === 'losses' && <LossHistory {...props} />}
    </>
  );
}

function Transactions({ d }: { d: PolicyDetail }) {
  return (
    <Panel title="Policy Transactions">
      <table className="list">
        <thead><tr><th>Transaction #</th><th>Type</th><th>Status</th><th>Effective</th><th>Description</th><th>Term / Model</th><th className="r">Premium</th></tr></thead>
        <tbody>
          {[...d.transactions].reverse().map((t) => (
            <tr key={t.id}>
              <td><Link to={`/submissions/${t.id}`}>{t.jobNumber}</Link></td>
              <td>{t.jobTypeLabel}</td>
              <td><StatusBadge status={t.status} label={STATUS_TEXT[t.status] ?? t.status} /></td>
              <td>{fmtDate(t.effectiveDate)}</td>
              <td>{t.description || '-'}</td>
              <td>{t.termNumber ? `${t.termNumber} / ${t.modelNumber}` : '-'}</td>
              <td className="r">{t.transactionPremium === null ? '-' : money(t.transactionPremium)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function Billing({ d, reload, setErrors }: { d: PolicyDetail; reload: () => void; setErrors: (e: string[]) => void }) {
  const pay = async (invoiceId: number) => {
    try {
      await api(`/invoices/${invoiceId}/pay`, { body: {} });
      reload();
    } catch (e: any) {
      setErrors([e.message]);
    }
  };
  const b = d.billing;
  return (
    <>
      <div className="kpis kpis-4">
        <div className="kpi"><div className="kpi-value">{money(b.billed)}</div><div className="kpi-label">Billed</div></div>
        <div className="kpi kpi-quoted"><div className="kpi-value">{money(b.paid)}</div><div className="kpi-label">Paid</div></div>
        <div className={`kpi${b.outstanding > 0 ? ' kpi-intake' : ''}`}><div className="kpi-value">{money(b.outstanding)}</div><div className="kpi-label">Outstanding</div></div>
        <div className="kpi kpi-withdrawn"><div className="kpi-value">{money(b.unbilled)}</div><div className="kpi-label">Unbilled</div></div>
      </div>
      <Panel title={`Invoices - ${b.paymentPlan}, ${b.billingMethod}`}>
        <table className="list">
          <thead><tr><th>Invoice #</th><th>Due</th><th>Description</th><th>Transaction</th><th className="r">Amount</th><th>Status</th><th /></tr></thead>
          <tbody>
            {d.invoices.map((i) => (
              <tr key={i.id} className={i.status === 'Billed' && i.amount > 0 && i.dueDate < today() ? 'overdue' : ''}>
                <td>{i.invoiceNumber}</td>
                <td>{fmtDate(i.dueDate)}</td>
                <td>{i.description}</td>
                <td>{d.transactions.find((t) => t.id === i.jobId)?.jobNumber}</td>
                <td className="r">{money(i.amount)}</td>
                <td><StatusBadge status={i.status === 'Paid' ? 'PASS' : i.status === 'Cancelled' ? 'WITHDRAWN' : i.status === 'Billed' ? 'REFER' : 'DRAFT'} label={i.status === 'Billed' && i.dueDate < today() && i.amount > 0 ? 'Past Due' : i.status} /></td>
                <td>{i.status === 'Billed' && <Button onClick={() => pay(i.id)}>{i.amount < 0 ? 'Issue Refund' : 'Record Payment'}</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="muted">Installments are billed 20 days before they fall due.</div>
      </Panel>
    </>
  );
}

function ChangeDialog({ d, onClose, onStart }: { d: PolicyDetail; onClose: () => void; onStart: (b: unknown) => void }) {
  const p = d.currentPeriod;
  const [eff, setEff] = useState(p.periodStart > today() ? p.periodStart : today());
  const [desc, setDesc] = useState('');
  return (
    <Modal title="Change Policy" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button primary disabled={!desc.trim()} onClick={() => onStart({ effectiveDate: eff, description: desc })}>Start Policy Change</Button></>}>
      <FieldRow label="Effective Date" required hint={`Within the term ${fmtDate(p.periodStart)} - ${fmtDate(p.periodEnd)}`}><TextInput type="date" value={eff} onChange={setEff} /></FieldRow>
      <FieldRow label="Description" required><TextInput value={desc} onChange={setDesc} placeholder="e.g. Add location, increase limit" /></FieldRow>
    </Modal>
  );
}

function CancelDialog({ d, onClose, onStart }: { d: PolicyDetail; onClose: () => void; onStart: (b: unknown) => void }) {
  const p = d.currentPeriod;
  const [source, setSource] = useState<'Insured' | 'Carrier'>('Insured');
  const reasons = d.reference.cancellationReasons[source];
  const [reason, setReason] = useState(reasons[0].reason);
  const [method, setMethod] = useState('Pro Rata');
  const [eff, setEff] = useState(p.periodStart > today() ? p.periodStart : today());
  const notice = reasons.find((r) => r.reason === reason)?.noticeDays ?? 0;
  const termDays = (Date.parse(p.periodEnd) - Date.parse(p.periodStart)) / 86_400_000;
  const unearned = Math.max(0, (Date.parse(p.periodEnd) - Date.parse(eff)) / 86_400_000) / termDays;
  const factor = method === 'Flat' ? 1 : method === 'Short Rate' ? unearned * 0.9 : unearned;
  return (
    <Modal title="Cancel Policy" onClose={onClose} footer={<><Button onClick={onClose}>Close</Button><Button primary danger onClick={() => onStart({ effectiveDate: eff, source, reason, method })}>Start Cancellation</Button></>}>
      <FieldRow label="Source" required>
        <Select value={source} onChange={(v) => { setSource(v); setReason(d.reference.cancellationReasons[v][0].reason); if (v === 'Carrier' && method === 'Short Rate') setMethod('Pro Rata'); }} options={[{ value: 'Insured', label: 'Insured' }, { value: 'Carrier', label: 'Carrier' }] as { value: 'Insured' | 'Carrier'; label: string }[]} />
      </FieldRow>
      <FieldRow label="Reason" required><Select value={reason} onChange={setReason} options={reasons.map((r) => r.reason)} /></FieldRow>
      <FieldRow label="Refund Method" required>
        <Select value={method} onChange={setMethod} options={d.reference.cancellationMethods.filter((m) => source === 'Insured' || m !== 'Short Rate')} />
      </FieldRow>
      <FieldRow label="Effective Date" required hint={notice ? `${notice} days' notice required: earliest ${new Date(Date.now() + notice * 86_400_000).toISOString().slice(0, 10)}` : method === 'Flat' ? 'Flat cancellation must be effective on the term start date' : undefined}>
        <TextInput type="date" value={eff} onChange={setEff} />
      </FieldRow>
      <FieldRow label="Estimated Return">{money(p.termPremium * factor)} <span className="muted">({(factor * 100).toFixed(1)}% of {money(p.termPremium)})</span></FieldRow>
    </Modal>
  );
}

function ReinstateDialog({ d, onClose, onStart }: { d: PolicyDetail; onClose: () => void; onStart: (b: unknown) => void }) {
  const [reason, setReason] = useState('Payment received');
  return (
    <Modal title="Reinstate Policy" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button primary onClick={() => onStart({ reason })}>Start Reinstatement</Button></>}>
      <p>The policy was canceled effective {fmtDate(d.currentPeriod.cancellationDate)}. Reinstatement restores coverage with no lapse and re-applies the returned premium.</p>
      <FieldRow label="Reason" required><Select value={reason} onChange={setReason} options={['Payment received', 'Cancellation issued in error', 'Insured request - rescind cancellation', 'Subjectivities satisfied']} /></FieldRow>
    </Modal>
  );
}

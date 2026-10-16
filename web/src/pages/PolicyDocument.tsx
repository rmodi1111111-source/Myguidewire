import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, fmtDate, money, type PricingResult, type RiskData, type Subjectivity } from '../api';
import CoverageSchedule from '../components/CoverageSchedule';
import { Messages, Toolbar } from '../components/ui';

const CARRIER = 'Summit Ridge Insurance Company';

interface DocSnapshot {
  kind: string;
  policyNumber: string;
  productName: string;
  jobNumber: string;
  generatedAt: string;
  account: { name: string; dba: string; address1: string; city: string; state: string; zip: string; accountNumber: string };
  producer: { name: string; code: string; commissionPct: number };
  underwriter: { name: string; email: string } | null;
  termNumber: number;
  periodStart: string;
  periodEnd: string;
  editEffectiveDate: string;
  risk: RiskData;
  pricing: PricingResult;
  transactionPremium: number;
  termPremium: number;
  cancellationDate: string | null;
  forms: { number: string; title: string }[];
  paymentPlan: string;
  billingMethod: string;
  subjectivities?: Subjectivity[];
  description?: string;
  priorAnnualPremium?: number;
  newAnnualPremium?: number;
  source?: string;
  reason?: string;
  method?: string;
  returnPremium?: number;
  reinstatePremium?: number;
  noticeDate?: string;
}

interface DocData {
  id: number;
  name: string;
  docType: string;
  policyId: number;
  jobId: number;
  snapshot: DocSnapshot;
}

/** On-screen policy documents: binder, declarations, endorsements and notices. */
export default function PolicyDocument() {
  const { id } = useParams();
  const [data, setData] = useState<DocData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<DocData>(`/documents/${id}`).then(setData).catch((e) => setError(e.message));
  }, [id]);
  if (!data) return <div className="content-pad"><Messages errors={error ? [error] : []} infos={error ? [] : ['Loading...']} /></div>;
  const s = data.snapshot;
  const a = s.account;
  const showCoverage = ['Binder', 'Declarations', 'Renewal Declarations', 'Policy Change Endorsement'].includes(s.kind);

  return (
    <div className="content-pad">
      <Toolbar>
        <Link className="btn" to={`/policies/${data.policyId}/documents`}>&lt; Back to policy</Link>
        <Link className="btn" to={`/submissions/${data.jobId}`}>Open transaction {s.jobNumber}</Link>
      </Toolbar>
      <article className="proposal">
        <header className="proposal-head">
          <div>
            <div className="proposal-carrier">{CARRIER}</div>
            <div>{s.productName} - {s.kind}</div>
          </div>
          <div className="proposal-num">
            <b>Policy {s.policyNumber}</b>
            <div>Term {s.termNumber}: {fmtDate(s.periodStart)} - {fmtDate(s.periodEnd)}</div>
            <div>Prepared {fmtDate(s.generatedAt)}</div>
          </div>
        </header>
        {s.kind === 'Binder' && (
          <p className="proposal-disclaimer">
            This binder confirms coverage as described below, effective {fmtDate(s.periodStart)} at 12:01 AM standard time. It remains in effect until the policy is issued, or for 30 days, whichever is earlier, and is subject to the terms of the policy forms listed.
          </p>
        )}

        <h2>Named Insured & Producer</h2>
        <dl className="proposal-grid">
          <dt>Named Insured</dt><dd>{a.name}{a.dba ? ` dba ${a.dba}` : ''}</dd>
          <dt>Policy Number</dt><dd>{s.policyNumber}</dd>
          <dt>Mailing Address</dt><dd>{a.address1}, {a.city}, {a.state} {a.zip}</dd>
          <dt>Transaction</dt><dd>{s.jobNumber}</dd>
          <dt>Policy Period</dt><dd>{fmtDate(s.periodStart)} to {fmtDate(s.periodEnd)}, 12:01 AM standard time</dd>
          <dt>Effective</dt><dd>{fmtDate(s.editEffectiveDate)}</dd>
          <dt>Producer</dt><dd>{s.producer.name} ({s.producer.code})</dd>
          <dt>Underwriter</dt><dd>{s.underwriter?.name ?? '-'}</dd>
        </dl>

        {s.kind === 'Policy Change Endorsement' && (
          <>
            <h2>Endorsement</h2>
            <p>In consideration of the premium shown, the policy is amended effective <b>{fmtDate(s.editEffectiveDate)}</b> as follows: <b>{s.description}</b>. All other terms and conditions remain unchanged.</p>
            <PremiumTable rows={[
              ['Prior annual premium', s.priorAnnualPremium],
              ['Revised annual premium', s.newAnnualPremium],
              [s.transactionPremium >= 0 ? 'Additional premium (pro rata)' : 'Return premium (pro rata)', Math.abs(s.transactionPremium)],
              ['Written premium for the term', s.termPremium],
            ]} />
          </>
        )}

        {s.kind === 'Cancellation Notice' && (
          <>
            <h2>Notice of Cancellation</h2>
            <p>The policy is canceled effective <b>{fmtDate(s.cancellationDate)}</b> at 12:01 AM standard time.</p>
            <dl className="proposal-grid">
              <dt>Requested by</dt><dd>{s.source}</dd>
              <dt>Reason</dt><dd>{s.reason}</dd>
              <dt>Refund method</dt><dd>{s.method}</dd>
              <dt>Return premium</dt><dd>{money(s.returnPremium)}</dd>
            </dl>
            <p className="muted">Any return premium is credited to the insured's billing account. Earned premium that remains unpaid is still due.</p>
          </>
        )}

        {s.kind === 'Reinstatement Notice' && (
          <>
            <h2>Notice of Reinstatement</h2>
            <p>The policy is reinstated with no lapse in coverage, effective <b>{fmtDate(s.editEffectiveDate)}</b>. Reason: {s.reason}.</p>
            <PremiumTable rows={[['Premium reinstated', s.reinstatePremium], ['Written premium for the term', s.termPremium]]} />
          </>
        )}

        {s.kind === 'Non-Renewal Notice' && (
          <>
            <h2>Notice of Non-Renewal</h2>
            <p>The policy will not be renewed and expires at 12:01 AM standard time on <b>{fmtDate(s.periodEnd)}</b>.</p>
            <dl className="proposal-grid">
              <dt>Reason</dt><dd>{s.reason}</dd>
              <dt>Notice date</dt><dd>{fmtDate(s.noticeDate)}</dd>
            </dl>
          </>
        )}

        {showCoverage && (
          <>
            <h2>Coverage Schedule</h2>
            <CoverageSchedule risk={s.risk} />
            <h2>Premium</h2>
            <div className="table-scroll">
              <table className="list">
                <tbody>
                  {s.pricing.lines.map((l) => <tr key={l.coverage}><td>{l.coverage}</td><td className="r">{money(l.premium)}</td></tr>)}
                  <tr className="total"><td>Annual Premium</td><td className="r">{money(s.pricing.premium)}</td></tr>
                  {s.pricing.taxesAndFees.map((t) => <tr key={t.label}><td>{t.label}</td><td className="r">{money(t.amount)}</td></tr>)}
                  <tr className="total grand"><td>Written premium for the term</td><td className="r">{money(s.termPremium)}</td></tr>
                </tbody>
              </table>
            </div>
            <p className="muted">Payment plan: {s.paymentPlan}, {s.billingMethod}.</p>
          </>
        )}

        {s.kind === 'Binder' && !!s.subjectivities?.length && (
          <>
            <h2>Subjectivities</h2>
            <div className="table-scroll">
              <table className="list">
                <thead><tr><th>Subjectivity</th><th>Timing</th><th>Due</th><th>Status</th></tr></thead>
                <tbody>{s.subjectivities.map((x) => <tr key={x.id}><td>{x.text}</td><td>{x.timing}</td><td>{fmtDate(x.dueDate)}</td><td>{x.status}</td></tr>)}</tbody>
              </table>
            </div>
          </>
        )}

        {showCoverage && (
          <>
            <h2>Forms & Endorsements</h2>
            <div className="table-scroll">
              <table className="list">
                <thead><tr><th>Form Number</th><th>Title</th></tr></thead>
                <tbody>{s.forms.map((f) => <tr key={f.number}><td className="nowrap">{f.number}</td><td>{f.title}</td></tr>)}</tbody>
              </table>
            </div>
          </>
        )}
      </article>
    </div>
  );
}

function PremiumTable({ rows }: { rows: [string, number | undefined][] }) {
  return (
    <div className="table-scroll">
      <table className="list">
        <tbody>{rows.map(([k, v]) => <tr key={k}><td>{k}</td><td className="r">{money(v)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

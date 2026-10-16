import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { STANDALONE, api, fmtDate, money, type QuoteSnapshot } from '../api';
import { Messages, StatusBadge, Toolbar } from '../components/ui';
import CoverageSchedule from '../components/CoverageSchedule';

const CARRIER = 'Summit Ridge Insurance Company';

interface QuoteData {
  id: number;
  submissionId: number;
  status: string;
  snapshot: QuoteSnapshot;
}

/** On-screen quote proposal, the same content as the PDF document. */
export default function QuoteProposal() {
  const { id } = useParams();
  const [data, setData] = useState<QuoteData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<QuoteData>(`/quotes/${id}`).then(setData).catch((e) => setError(e.message));
  }, [id]);
  if (!data) return <div className="content-pad"><Messages errors={error ? [error] : []} infos={error ? [] : ['Loading...']} /></div>;

  const s = data.snapshot;
  const a = s.account;
  const p = s.pricing;
  const r = s.risk;

  return (
    <div className="content-pad">
      <Toolbar>
        <Link className="btn" to={`/submissions/${data.submissionId}/quote`}>&lt; Back to submission</Link>
        <StatusBadge status={data.status === 'Active' ? 'QUOTED' : 'WITHDRAWN'} label={data.status} />
        {!STANDALONE && <a className="btn" href={`/api/quotes/${data.id}/pdf`} target="_blank" rel="noreferrer">Open as PDF</a>}
      </Toolbar>
      <article className="proposal">
        <header className="proposal-head">
          <div>
            <div className="proposal-carrier">{CARRIER}</div>
            <div>{s.productName} - Quote Proposal</div>
          </div>
          <div className="proposal-num">
            <b>{s.quoteNumber}</b>
            <div>Issued {fmtDate(s.issuedAt)}</div>
            <div>Valid until {fmtDate(s.validUntil)}</div>
          </div>
        </header>
        <p className="proposal-disclaimer">
          This is a quotation only. It is not a binder, policy or certificate of insurance. Coverage is not in force until bound in writing by the company and all subjectivities are satisfied.
        </p>

        <h2>Quote Information</h2>
        <dl className="proposal-grid">
          <dt>Named Insured</dt><dd>{a.name}{a.dba ? ` dba ${a.dba}` : ''}</dd>
          <dt>Submission #</dt><dd>{s.jobNumber}</dd>
          <dt>Mailing Address</dt><dd>{a.address1}, {a.city}, {a.state} {a.zip}</dd>
          <dt>Account #</dt><dd>{a.accountNumber}</dd>
          <dt>Policy Period</dt><dd>{fmtDate(s.effectiveDate)} to {fmtDate(s.expirationDate)}, 12:01 AM standard time</dd>
          <dt>Option</dt><dd>{s.versionName}</dd>
          <dt>Producer</dt><dd>{s.producer.name} ({s.producer.code})</dd>
          <dt>Underwriter</dt><dd>{s.underwriter ? `${s.underwriter.name}, ${s.underwriter.email}` : '-'}</dd>
          <dt>Business</dt><dd>{a.industry || a.naics}</dd>
          <dt>Annual Revenue</dt><dd>{money(a.annualRevenue)}</dd>
          {s.scan && <><dt>CRP Risk Score</dt><dd>{s.scan.compositeScore} (Grade {s.scan.grade})</dd></>}
        </dl>

        <h2>Coverage Schedule</h2>
        <CoverageSchedule risk={r} />

        <h2>Premium Summary</h2>
        <div className="table-scroll">
          <table className="list">
            <tbody>
              {p.lines.map((l) => <tr key={l.coverage}><td>{l.coverage}</td><td className="r">{money(l.premium)}</td></tr>)}
              <tr className="total"><td>Total Premium</td><td className="r">{money(p.premium)}</td></tr>
              {p.taxesAndFees.map((t) => <tr key={t.label}><td>{t.label}</td><td className="r">{money(t.amount)}</td></tr>)}
              <tr className="total grand"><td>Total Cost</td><td className="r">{money(p.totalCost)}</td></tr>
            </tbody>
          </table>
        </div>
        <p className="muted">Producer commission: {s.producer.commissionPct}%.</p>

        <h2>Subjectivities</h2>
        <p className="muted">To be received prior to binding unless otherwise stated.</p>
        <ol>{s.subjectivities.map((x) => <li key={x}>{x}</li>)}</ol>

        <h2>Forms & Endorsements</h2>
        <div className="table-scroll">
          <table className="list">
            <thead><tr><th>Form Number</th><th>Title</th></tr></thead>
            <tbody>{s.forms.map((f) => <tr key={f.number}><td className="nowrap">{f.number}</td><td>{f.title}</td></tr>)}</tbody>
          </table>
        </div>

        <h2>Terms & Conditions</h2>
        <p>This quotation is valid until {fmtDate(s.validUntil)} and is based on the information provided in the application and supplemental materials. Any material change in the risk prior to binding may result in a revised quotation or withdrawal of this offer.</p>
        <p>Coverage is provided solely under the terms, conditions, limitations and exclusions of the policy forms listed above. If this proposal and the policy conflict, the policy governs.</p>
        <p>Binding instructions must be received in writing from the producer of record. This proposal does not bind coverage.</p>
      </article>
    </div>
  );
}

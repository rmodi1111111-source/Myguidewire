import { Link } from 'react-router-dom';
import { fmtDate, fmtDateTime, money } from '../../api';
import { FieldRow, Panel, StatusBadge } from '../../components/ui';
import type { StepProps } from '../SubmissionPage';

export default function Summary({ detail }: StepProps) {
  const { submission: s, account, versions, issues, quotes } = detail;
  const selected = versions.find((v) => v.id === detail.selectedVersionId)!;
  const openIssues = issues.filter((i) => i.versionId === selected.id && i.status === 'Open' && i.blockingPoint !== 'Informational');
  const activeQuote = quotes.find((q) => q.status === 'Active');

  // Pipeline tracker
  const stages = [
    { label: 'Intake', done: true },
    { label: 'Clearance', done: !!s.clearance && !['INTAKE', 'CLEARANCE_REFERRAL'].includes(s.status) && !(s.status === 'DECLINED' && !s.clearance?.override && s.clearance.outcome === 'DECLINE') },
    { label: 'Risk Entry', done: detail.validation.every((v) => v.level !== 'error') },
    { label: 'CRP Scan', done: !!s.scan },
    { label: 'Pricing', done: !!selected.pricing },
    { label: 'UW Review', done: !!selected.pricing && openIssues.filter((i) => i.blockingPoint === 'Quote').length === 0 },
    { label: 'Quote', done: s.status === 'QUOTED' },
  ];

  return (
    <>
      <div className="pipeline">
        {stages.map((st, i) => (
          <div key={st.label} className={`pipe-stage${st.done ? ' done' : ''}`}>
            <span className="pipe-num">{st.done ? '✓' : i + 1}</span>
            {st.label}
          </div>
        ))}
      </div>
      <div className="grid-2">
        <Panel title="Submission">
          <FieldRow label="Submission #">{s.jobNumber}</FieldRow>
          <FieldRow label="Status"><StatusBadge status={s.status} label={s.statusLabel} /></FieldRow>
          <FieldRow label="Policy Period">{fmtDate(s.effectiveDate)} - {fmtDate(s.expirationDate)}</FieldRow>
          <FieldRow label="Received">{fmtDate(s.receivedDate)} via {s.source}</FieldRow>
          <FieldRow label="Priority">{s.priority}</FieldRow>
          <FieldRow label="Producer">{detail.producer.code} - {detail.producer.name}</FieldRow>
          <FieldRow label="Underwriter">{detail.underwriter?.name ?? 'Unassigned'}</FieldRow>
          <FieldRow label="Broker Notes">{s.description || '-'}</FieldRow>
          <FieldRow label="Created">{fmtDateTime(s.createdAt)}</FieldRow>
        </Panel>
        <Panel title="Account">
          <FieldRow label="Named Insured"><Link to={`/accounts/${account.id}`}>{account.name}</Link></FieldRow>
          <FieldRow label="Account #">{account.accountNumber}</FieldRow>
          <FieldRow label="FEIN">{account.fein || '-'}</FieldRow>
          <FieldRow label="Industry">{account.naics} {account.industry}</FieldRow>
          <FieldRow label="Address">{account.address1}, {account.city}, {account.state} {account.zip}</FieldRow>
          <FieldRow label="Revenue">{money(account.annualRevenue)}</FieldRow>
          <FieldRow label="Employees">{account.employeeCount}</FieldRow>
          <FieldRow label="Website">{account.website || '-'}</FieldRow>
        </Panel>
      </div>
      <div className="grid-3">
        <Panel title="Clearance">
          {s.clearance ? (
            <>
              <StatusBadge status={s.clearance.outcome} /> {s.clearance.override && <em> overridden by {s.clearance.override.by}</em>}
              <ul className="compact">
                {s.clearance.checks.filter((c) => c.outcome !== 'PASS').map((c) => <li key={c.code}>{c.name}: {c.message}</li>)}
              </ul>
            </>
          ) : 'Not run'}
          <Link to="clearance">Details</Link>
        </Panel>
        <Panel title="CRP Scan">
          {s.scan ? (
            <div className="score-inline">
              <span className={`grade grade-${s.scan.grade}`}>{s.scan.grade}</span>
              <span><b>{s.scan.compositeScore}</b> / 950<br />{s.scan.sections.flatMap((x) => x.findings).length} findings - {fmtDateTime(s.scan.runAt)}</span>
            </div>
          ) : 'Not run'}
          <Link to="risk-analysis">Details</Link>
        </Panel>
        <Panel title="Underwriting">
          <div>{openIssues.length} open UW issue(s) on {selected.name}</div>
          <div>{issues.filter((i) => i.versionId === selected.id && i.status === 'Approved').length} approved</div>
          {activeQuote ? (
            <div className="mt">Active quote <b>{activeQuote.quoteNumber}</b> - {money(activeQuote.premium)} (valid until {fmtDate(activeQuote.validUntil)})</div>
          ) : <div className="mt">No active quote</div>}
          <Link to="quote">Quote</Link>
        </Panel>
      </div>
      <Panel title="Versions">
        <table className="list">
          <thead><tr><th>Version</th><th>Status</th><th className="r">Premium</th><th className="r">Total Cost</th><th>Selected</th></tr></thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.id}>
                <td>{v.name}</td><td>{v.status}</td><td className="r">{money(v.pricing?.premium)}</td><td className="r">{money(v.pricing?.totalCost)}</td>
                <td>{v.id === detail.selectedVersionId ? 'Yes' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}

import { Link, useNavigate } from 'react-router-dom';
import { STANDALONE, fmtDate, fmtDateTime, money } from '../../api';
import { Button, Empty, Panel, StatusBadge, Toolbar } from '../../components/ui';
import type { StepProps } from '../SubmissionPage';

export default function QuoteStep({ detail, act }: StepProps) {
  const nav = useNavigate();
  const s = detail.submission;
  const active = detail.quotes.find((q) => q.status === 'Active');
  const sel = detail.versions.find((v) => v.id === detail.selectedVersionId)!;

  return (
    <>
      {active ? (
        <Panel title={`Quote ${active.quoteNumber}`}>
          <div className="quote-card">
            <div>
              <div className="big">{money(active.totalCost)}</div>
              <div className="muted">Total cost (premium {money(active.premium)} + taxes & fees)</div>
            </div>
            <div>
              <div><b>Version:</b> {detail.versions.find((v) => v.id === active.versionId)?.name}</div>
              <div><b>Issued:</b> {fmtDateTime(active.createdAt)} by {active.createdBy}</div>
              <div><b>Valid until:</b> {fmtDate(active.validUntil)}</div>
            </div>
            <Toolbar>
              <Link className="btn btn-primary" to={`/quotes/${active.id}`}>View Quote Proposal</Link>
              {!STANDALONE && <a className="btn" href={`/api/quotes/${active.id}/pdf`} target="_blank" rel="noreferrer">PDF</a>}
            </Toolbar>
          </div>
          <div className="msg msg-info">
            The quote is ready to send to {detail.producer.name} ({detail.producer.email}). Binding is outside the scope of this pre-bind workbench; the submission stays in Quoted status for hand-off to policy administration.
          </div>
        </Panel>
      ) : (
        <Panel title="Quote">
          {s.status === 'RATED' ? (
            detail.quoteBlockers.length ? (
              <>
                <div className="msg msg-error">The quote cannot be issued until the following are resolved:</div>
                <ul className="compact">{detail.quoteBlockers.map((b) => <li key={b}>{b}</li>)}</ul>
                <Toolbar><Button onClick={() => nav(`/submissions/${s.id}/risk-analysis`)}>Go to Risk Analysis</Button></Toolbar>
              </>
            ) : (
              <>
                <p>{sel.name} is rated at <b>{money(sel.pricing?.premium)}</b> premium ({money(sel.pricing?.totalCost)} total cost) with no quote-blocking issues.</p>
                <Toolbar><Button primary onClick={() => act('/quote')}>Issue Quote & Generate Proposal</Button></Toolbar>
              </>
            )
          ) : (
            <Empty>{s.status === 'DRAFT' ? 'Rate the submission first (toolbar: Rate).' : `No active quote. Submission status: ${s.statusLabel}.`}</Empty>
          )}
        </Panel>
      )}

      <Panel title="Subjectivities">
        <ul className="compact">
          {detail.subjectivities.map((x) => <li key={x}>{x}</li>)}
        </ul>
      </Panel>

      <Panel title="Quote History">
        {!detail.quotes.length ? <Empty>No quotes issued.</Empty> : (
          <table className="list">
            <thead><tr><th>Quote #</th><th>Version</th><th>Status</th><th className="r">Premium</th><th className="r">Total Cost</th><th>Valid Until</th><th>Issued</th><th /></tr></thead>
            <tbody>
              {detail.quotes.map((q) => (
                <tr key={q.id}>
                  <td>{q.quoteNumber}</td>
                  <td>{detail.versions.find((v) => v.id === q.versionId)?.name}</td>
                  <td><StatusBadge status={q.status === 'Active' ? 'QUOTED' : 'WITHDRAWN'} label={q.status} /></td>
                  <td className="r">{money(q.premium)}</td>
                  <td className="r">{money(q.totalCost)}</td>
                  <td>{fmtDate(q.validUntil)}</td>
                  <td>{fmtDateTime(q.createdAt)} - {q.createdBy}</td>
                  <td><Link to={`/quotes/${q.id}`}>View</Link>{!STANDALONE && <> | <a href={`/api/quotes/${q.id}/pdf`} target="_blank" rel="noreferrer">PDF</a></>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}

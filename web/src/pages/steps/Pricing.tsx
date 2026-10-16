import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fmtDateTime, money, type Version } from '../../api';
import { Button, Empty, Messages, Panel, TextInput, Toolbar } from '../../components/ui';
import type { StepProps } from '../SubmissionPage';

export default function Pricing({ detail, act, editable, save }: StepProps) {
  const nav = useNavigate();
  const sel = detail.versions.find((v) => v.id === detail.selectedVersionId)!;
  const [view, setView] = useState<number>(sel.id);
  const [rename, setRename] = useState<{ id: number; name: string } | null>(null);
  const v = detail.versions.find((x) => x.id === view) ?? sel;
  const p = v.pricing;
  const sections = p ? [...new Set(p.worksheet.map((w) => w.section))] : [];
  const vIssues = detail.issues.filter((i) => i.versionId === v.id);

  return (
    <>
      <Panel
        title="Quote Versions"
        actions={editable && <Button onClick={async () => { if (await save()) act(`/versions/${sel.id}/copy`); }} disabled={detail.versions.length >= 5}>Copy Selected Version</Button>}
      >
        <table className="list">
          <thead><tr><th>Version</th><th>Status</th><th>Key Terms</th><th className="r">Premium</th><th className="r">Taxes & Fees</th><th className="r">Total Cost</th><th>Open Issues</th><th /></tr></thead>
          <tbody>
            {detail.versions.map((x) => (
              <tr key={x.id} className={`clickable${x.id === view ? ' selected' : ''}`} onClick={() => setView(x.id)}>
                <td>
                  {rename?.id === x.id ? (
                    <span onClick={(e) => e.stopPropagation()}>
                      <TextInput value={rename.name} onChange={(n) => setRename({ id: x.id, name: n })} />
                      <Button onClick={async () => { await act(`/versions/${x.id}`, { name: rename.name }, 'PUT'); setRename(null); }}>OK</Button>
                    </span>
                  ) : (
                    <>
                      <b>{x.name}</b> {x.id === sel.id && <span className="tag">Selected</span>}
                    </>
                  )}
                </td>
                <td>{x.status}</td>
                <td className="muted">{keyTerms(x)}</td>
                <td className="r">{money(x.pricing?.premium)}</td>
                <td className="r">{money(x.pricing ? x.pricing.totalCost - x.pricing.premium : null)}</td>
                <td className="r"><b>{money(x.pricing?.totalCost)}</b></td>
                <td>{detail.issues.filter((i) => i.versionId === x.id && i.status === 'Open' && i.blockingPoint === 'Quote').length || '-'}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  {editable && (
                    <Toolbar>
                      {x.id !== sel.id && <Button onClick={() => act(`/versions/${x.id}/select`)}>Select</Button>}
                      {x.status === 'Draft' && <Button onClick={() => act('/rate', { versionId: x.id })}>Rate</Button>}
                      <Button onClick={() => setRename({ id: x.id, name: x.name })}>Rename</Button>
                    </Toolbar>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="muted">Wizard steps edit the selected version. Copy a version to build alternative limit/retention options for the broker.</div>
      </Panel>

      {!p ? (
        <Panel title={`${v.name} - Premium`}>
          <Empty>This version has not been rated. {editable && 'Click Rate in the toolbar.'}</Empty>
          <Messages errors={detail.validation.filter((m) => m.level === 'error').map((m) => `${m.step}: ${m.message}`)} />
        </Panel>
      ) : (
        <>
          <div className="grid-2">
            <Panel title={`${v.name} - Premium Summary`}>
              <table className="list">
                <thead><tr><th>Coverage</th><th className="r">Premium</th></tr></thead>
                <tbody>
                  {p.lines.map((l) => <tr key={l.coverage}><td>{l.coverage}</td><td className="r">{money(l.premium)}</td></tr>)}
                  <tr className="total"><td>Total Premium</td><td className="r">{money(p.premium)}</td></tr>
                  {p.taxesAndFees.map((t) => <tr key={t.label}><td>{t.label}</td><td className="r">{money(t.amount)}</td></tr>)}
                  <tr className="total grand"><td>Total Cost</td><td className="r">{money(p.totalCost)}</td></tr>
                </tbody>
              </table>
              <div className="muted">Technical premium {money(p.technicalPremium)}{p.minimumPremiumApplied && ' - minimum premium applied'}. Rated {fmtDateTime(p.ratedAt)}.</div>
            </Panel>
            <Panel title="Quote Readiness">
              {v.id !== sel.id ? <div className="muted">Select this version to quote it.</div> : detail.quoteBlockers.length ? (
                <>
                  <div className="msg msg-error">Quote is blocked:</div>
                  <ul className="compact">{detail.quoteBlockers.map((b) => <li key={b}>{b}</li>)}</ul>
                  <Toolbar><Button onClick={() => nav(`/submissions/${detail.submission.id}/risk-analysis`)}>Go to Risk Analysis</Button></Toolbar>
                </>
              ) : (
                <>
                  <div className="msg msg-info">All quote-blocking underwriting issues are resolved.</div>
                  <div>{vIssues.filter((i) => i.blockingPoint === 'Bind').length} bind-level issue(s) will appear as subjectivities.</div>
                  <Toolbar>
                    {detail.submission.status === 'RATED' && <Button primary onClick={async () => { if (await act('/quote')) nav(`/submissions/${detail.submission.id}/quote`); }}>Issue Quote</Button>}
                  </Toolbar>
                </>
              )}
            </Panel>
          </div>
          <Panel title="Rating Worksheet">
            {sections.map((s) => (
              <div key={s} className="ws-section">
                <div className="ws-title">{s}</div>
                <table className="list worksheet">
                  <tbody>
                    {p.worksheet.filter((w) => w.section === s).map((w, i) => (
                      <tr key={i}>
                        <td>{w.label}{w.basis && <span className="muted"> ({w.basis})</span>}</td>
                        <td className="r" style={{ width: 120 }}>{w.factor !== undefined ? (typeof w.factor === 'number' ? w.factor.toFixed(4).replace(/0+$/, '').replace(/\.$/, '') : w.factor) : ''}</td>
                        <td className="r" style={{ width: 120 }}>{w.amount !== undefined ? money(w.amount) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </Panel>
        </>
      )}
    </>
  );
}

function keyTerms(v: Version): string {
  const r = v.risk;
  if (r.product === 'CYBER') return `${money(r.coverages.aggregateLimit)} xs ${money(r.coverages.retention)}`;
  if (r.product === 'PROPERTY') return `${r.buildings.length} bldg(s), ${r.coverages.causeOfLoss}, ${money(r.coverages.aopDeductible)} ded`;
  return `${r.coverages.limitOption}, ${r.exposures.length} class(es)`;
}

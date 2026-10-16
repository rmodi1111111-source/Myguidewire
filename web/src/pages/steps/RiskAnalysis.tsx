import { Fragment, useState } from 'react';
import { api, ApiError, fmtDateTime, type SubmissionDetail, type UWIssue } from '../../api';
import { Button, Empty, Messages, Modal, Panel, StatusBadge, Tabs, Toolbar } from '../../components/ui';
import { useApp } from '../../context';
import type { StepProps } from '../SubmissionPage';

type Tab = 'issues' | 'scan' | 'validation';

export default function RiskAnalysis(props: StepProps) {
  const { detail, act, save, editable } = props;
  const [tab, setTab] = useState<Tab>('issues');
  const issues = detail.issues.filter((i) => i.versionId === detail.selectedVersionId);
  const open = issues.filter((i) => i.status === 'Open').length;
  return (
    <>
      <Tabs
        tabs={[
          { key: 'issues', label: `Underwriter Issues (${open} open)` },
          { key: 'scan', label: `CRP Scan${detail.submission.scan ? ` (${detail.submission.scan.compositeScore})` : ''}` },
          { key: 'validation', label: `Validation (${detail.validation.length})` },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'issues' && <Issues {...props} issues={issues} />}
      {tab === 'scan' && <Scan detail={detail} canRun={editable} run={async () => { if (await save()) await act('/scan'); }} />}
      {tab === 'validation' && (
        <Panel title="Validation Results">
          {!detail.validation.length ? <Empty>No validation issues.</Empty> : (
            <table className="list">
              <thead><tr><th>Level</th><th>Step</th><th>Message</th></tr></thead>
              <tbody>{detail.validation.map((v, i) => <tr key={i}><td><StatusBadge status={v.level === 'error' ? 'DECLINE' : 'REFER'} label={v.level} /></td><td>{v.step}</td><td>{v.message}</td></tr>)}</tbody>
            </table>
          )}
        </Panel>
      )}
    </>
  );
}

function Issues({ detail, act, editable, setDetail, issues }: StepProps & { issues: UWIssue[] }) {
  const { user } = useApp();
  const [expanded, setExpanded] = useState<number | null>(null);
  const [decision, setDecision] = useState<{ issue: UWIssue; kind: 'Approve' | 'Reject' } | null>(null);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ errors: string[]; infos: string[] }>({ errors: [], infos: [] });

  const refresh = async () => setDetail(await api<SubmissionDetail>(`/submissions/${detail.submission.id}`));
  const run = async (fn: () => Promise<unknown>, info?: string) => {
    try {
      const r = await fn();
      setMsg({ errors: [], infos: info ? [info.replace('{to}', (r as any)?.referredTo ?? '')] : [] });
      await refresh();
    } catch (e) {
      setMsg({ errors: [e instanceof ApiError ? e.message : String(e)], infos: [] });
    }
  };

  const order = { Quote: 0, Bind: 1, Informational: 2 } as const;
  const sorted = [...issues].sort((a, b) => order[a.blockingPoint] - order[b.blockingPoint] || b.requiredAuthority - a.requiredAuthority);

  return (
    <Panel title="Underwriter Issues" actions={editable && <Button onClick={() => act('/evaluate')}>Re-evaluate Rules</Button>}>
      <Messages errors={msg.errors} infos={msg.infos} />
      {!detail.versions.find((v) => v.id === detail.selectedVersionId)?.pricing && <div className="msg msg-info">Rate the submission to evaluate premium-based rules.</div>}
      {!sorted.length ? <Empty>No underwriting issues raised.</Empty> : (
        <table className="list">
          <thead>
            <tr><th>Status</th><th>Issue</th><th>Blocks</th><th>Authority</th><th>Decided By</th><th style={{ width: 230 }} /></tr>
          </thead>
          <tbody>
            {sorted.map((i) => {
              const canDecide = editable && user.authorityLevel >= i.requiredAuthority;
              return (
                <Fragment key={i.id}>
                  <tr className="clickable" onClick={() => setExpanded(expanded === i.id ? null : i.id)}>
                    <td><StatusBadge status={i.status === 'Open' ? 'REFER' : i.status === 'Approved' ? 'PASS' : 'DECLINE'} label={i.status} /></td>
                    <td><b>{i.shortDescription}</b></td>
                    <td>{i.blockingPoint}</td>
                    <td>Level {i.requiredAuthority}</td>
                    <td>{i.decidedBy ? `${i.decidedBy} ${fmtDateTime(i.decidedAt)}` : '-'}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {editable && i.status === 'Open' && i.blockingPoint !== 'Informational' && (
                        <Toolbar>
                          {canDecide ? (
                            <>
                              <Button primary onClick={() => { setNote(''); setDecision({ issue: i, kind: 'Approve' }); }}>Approve</Button>
                              <Button onClick={() => { setNote(''); setDecision({ issue: i, kind: 'Reject' }); }}>Reject</Button>
                            </>
                          ) : (
                            <Button onClick={() => run(() => api(`/issues/${i.id}/refer`, { body: {} }), 'Referred to {to} - an approval activity was created.')}>Refer for Approval</Button>
                          )}
                        </Toolbar>
                      )}
                      {editable && i.status !== 'Open' && i.blockingPoint !== 'Informational' && canDecide && (
                        <Button onClick={() => run(() => api(`/issues/${i.id}/decision`, { body: { decision: 'Reopen' } }))}>Reopen</Button>
                      )}
                    </td>
                  </tr>
                  {expanded === i.id && (
                    <tr className="detail-row">
                      <td />
                      <td colSpan={5}>
                        <div>{i.longDescription}</div>
                        <div className="muted">Rule {i.code} - value {i.value}</div>
                        {i.subjectivity && <div><b>Subjectivity:</b> {i.subjectivity}</div>}
                        {i.decisionNote && <div><b>Decision note:</b> {i.decisionNote}</div>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
      {decision && (
        <Modal
          title={`${decision.kind} UW Issue`}
          onClose={() => setDecision(null)}
          footer={
            <>
              <Button onClick={() => setDecision(null)}>Cancel</Button>
              <Button primary danger={decision.kind === 'Reject'} onClick={async () => { await run(() => api(`/issues/${decision.issue.id}/decision`, { body: { decision: decision.kind, note } })); setDecision(null); }}>
                {decision.kind}
              </Button>
            </>
          }
        >
          <p><b>{decision.issue.shortDescription}</b></p>
          <p>{decision.issue.longDescription}</p>
          {decision.kind === 'Reject' && <p className="msg msg-warning">A rejected issue blocks quoting until it is reopened or the risk changes.</p>}
          <textarea className="input textarea" placeholder="Decision note / conditions" value={note} onChange={(e) => setNote(e.target.value)} />
        </Modal>
      )}
    </Panel>
  );
}

const SEV_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3, Info: 4 } as const;

function Scan({ detail, canRun, run }: { detail: SubmissionDetail; canRun: boolean; run: () => void }) {
  const scan = detail.submission.scan;
  const product = detail.submission.product;
  const what = product === 'CYBER' ? 'outside-in security posture scan of the insured domains' : product === 'PROPERTY' ? 'natural hazard and site profile for each location' : 'operations hazard, regulatory and litigation profile';
  return (
    <>
      <Panel title="CRP - Comprehensive Risk Profile" actions={canRun && <Button primary onClick={run}>{scan ? 'Re-run CRP Scan' : 'Run CRP Scan'}</Button>}>
        {!scan ? <Empty>No scan on file. The CRP scan runs an {what}.{product === 'CYBER' && ' The posture score is a rating factor.'}</Empty> : (
          <div className="scan-head">
            <div className={`gauge grade-${scan.grade}`}>
              <div className="gauge-score">{scan.compositeScore}</div>
              <div className="gauge-label">Grade {scan.grade}</div>
            </div>
            <div className="scan-meta">
              <div><b>Provider:</b> {scan.provider}</div>
              <div><b>Run:</b> {fmtDateTime(scan.runAt)}</div>
              <div><b>Findings:</b> {(['Critical', 'High', 'Medium', 'Low'] as const).map((s) => `${scan.sections.flatMap((x) => x.findings).filter((f) => f.severity === s).length} ${s}`).join(' | ')}</div>
              <div className="score-bar"><div style={{ width: `${((scan.compositeScore - 300) / 650) * 100}%` }} /></div>
              <div className="muted">Scale 300 - 950. A &ge; 850, B &ge; 750, C &ge; 650, D &ge; 550, F &lt; 550.</div>
            </div>
          </div>
        )}
      </Panel>
      {scan?.sections.map((s) => (
        <Panel key={s.name} title={<>{s.name} <span className={`grade-pill grade-${s.grade}`}>{s.grade} {s.score}</span></>}>
          <div className="kv-inline">
            {Object.entries(s.summary).map(([k, v]) => (
              <span key={k}><b>{k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}:</b> {typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)}</span>
            ))}
          </div>
          {!s.findings.length ? <div className="muted">No adverse findings.</div> : (
            <table className="list">
              <thead><tr><th style={{ width: 90 }}>Severity</th><th>Finding</th><th>Detail</th><th className="r">Impact</th></tr></thead>
              <tbody>
                {[...s.findings].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]).map((f, i) => (
                  <tr key={i}><td><span className={`sev sev-${f.severity.toLowerCase()}`}>{f.severity}</span></td><td>{f.title}</td><td>{f.detail}</td><td className="r">-{f.impact}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      ))}
    </>
  );
}

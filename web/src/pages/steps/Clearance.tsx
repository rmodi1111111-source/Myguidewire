import { useState } from 'react';
import { fmtDateTime } from '../../api';
import { Button, Empty, Panel, StatusBadge, Toolbar } from '../../components/ui';
import { useApp } from '../../context';
import type { StepProps } from '../SubmissionPage';

export default function Clearance({ detail, act }: StepProps) {
  const { user } = useApp();
  const s = detail.submission;
  const c = s.clearance;
  const [reason, setReason] = useState('');
  const canRun = ['INTAKE', 'CLEARANCE_REFERRAL', 'DRAFT'].includes(s.status);
  const canOverride = (s.status === 'CLEARANCE_REFERRAL' || (s.status === 'DECLINED' && c?.outcome === 'DECLINE' && !c.override));
  const needed = c?.outcome === 'DECLINE' ? 3 : 2;

  return (
    <>
      <Panel
        title={<>Clearance Result {c && <StatusBadge status={c.outcome} />}</>}
        actions={canRun && <Button onClick={() => act('/clearance')}>Re-run Clearance</Button>}
      >
        {!c ? <Empty>Clearance has not been run.</Empty> : (
          <>
            <div className="muted">Run {fmtDateTime(c.runAt)}</div>
            <table className="list">
              <thead><tr><th style={{ width: 230 }}>Check</th><th style={{ width: 90 }}>Result</th><th>Finding</th></tr></thead>
              <tbody>
                {c.checks.map((ch) => (
                  <tr key={ch.code}>
                    <td><b>{ch.name}</b></td>
                    <td><StatusBadge status={ch.outcome} /></td>
                    <td>
                      {ch.message}
                      {!!ch.details?.length && <ul className="compact">{ch.details.map((d, i) => <li key={i}>{d}</li>)}</ul>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {c.override && (
              <div className="msg msg-info">
                Overridden by <b>{c.override.by}</b> on {fmtDateTime(c.override.at)}: {c.override.reason}
              </div>
            )}
          </>
        )}
      </Panel>
      {canOverride && (
        <Panel title="Underwriter Clearance Decision">
          <p>
            {c?.outcome === 'DECLINE'
              ? 'This submission was automatically declined at clearance. An underwriting manager (authority 3) may override and release it to underwriting.'
              : 'This submission was referred at clearance. A senior underwriter (authority 2+) may clear it for underwriting, or decline it.'}
          </p>
          <textarea className="input textarea" placeholder="Override justification (required) - e.g. BOR letter received from producer dated..." value={reason} onChange={(e) => setReason(e.target.value)} />
          <Toolbar>
            <Button primary disabled={user.authorityLevel < needed || !reason.trim()} title={user.authorityLevel < needed ? `Requires authority ${needed}` : undefined} onClick={() => act('/clearance/override', { reason })}>
              Clear for Underwriting
            </Button>
            {user.authorityLevel < needed && <span className="muted">Your authority level ({user.authorityLevel}) is insufficient - switch to a user with level {needed}.</span>}
          </Toolbar>
        </Panel>
      )}
    </>
  );
}

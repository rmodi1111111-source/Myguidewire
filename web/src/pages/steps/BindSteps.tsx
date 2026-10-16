import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate, money, type SubmissionDetail } from '../../api';
import { Button, Empty, FieldRow, Messages, Panel, Select, StatusBadge, Toolbar } from '../../components/ui';
import { useApp } from '../../context';
import type { StepProps } from '../SubmissionPage';

function BoundBanner({ detail }: { detail: SubmissionDetail }) {
  if (detail.submission.status !== 'BOUND' || !detail.policy) return null;
  return (
    <div className="msg msg-info">
      {detail.jobTypeLabel} bound. <Link to={`/policies/${detail.policy.id}`}>Open policy {detail.policy.policyNumber}</Link> ({detail.policy.status}).
    </div>
  );
}

function Blockers({ detail }: { detail: SubmissionDetail }) {
  if (!detail.bindBlockers.length || detail.submission.status === 'BOUND') return null;
  return (
    <Panel title="Bind is blocked">
      <ul className="compact">{detail.bindBlockers.map((b) => <li key={b}>{b}</li>)}</ul>
    </Panel>
  );
}

/** Subjectivity checklist: underwriters mark items received; waiving needs authority 2. */
export function SubjectivityChecklist({ detail, setDetail }: Pick<StepProps, 'detail' | 'setDetail'>) {
  const { user } = useApp();
  const [error, setError] = useState('');
  const decide = async (id: number, action: string) => {
    try {
      await api(`/subjectivities/${id}`, { body: { action } });
      setDetail(await api<SubmissionDetail>(`/submissions/${detail.submission.id}`));
      setError('');
    } catch (e: any) {
      setError(e.message);
    }
  };
  const items = detail.subjectivityItems;
  const bound = detail.submission.status === 'BOUND';
  return (
    <Panel title="Subjectivities">
      <Messages errors={error ? [error] : []} />
      {!items.length ? <Empty>Subjectivities are created when the quote is issued.</Empty> : (
        <table className="list">
          <thead><tr><th>Subjectivity</th><th>Timing</th><th>Due</th><th>Status</th><th style={{ width: 210 }} /></tr></thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id}>
                <td>{s.text}</td>
                <td>{s.timing}</td>
                <td>{fmtDate(s.dueDate)}</td>
                <td><StatusBadge status={s.status === 'Open' ? 'REFER' : 'PASS'} label={s.status} />{s.decidedBy && <div className="muted">{s.decidedBy}</div>}</td>
                <td>
                  {s.status === 'Open' ? (
                    <Toolbar>
                      <Button primary disabled={user.authorityLevel < 1} onClick={() => decide(s.id, 'receive')}>Received</Button>
                      <Button disabled={user.authorityLevel < 2} title={user.authorityLevel < 2 ? 'Requires authority 2' : undefined} onClick={() => decide(s.id, 'waive')}>Waive</Button>
                    </Toolbar>
                  ) : !bound && <Button onClick={() => decide(s.id, 'reopen')}>Reopen</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

/** Payment step: payment plan, billing method, subjectivities, Bind Only / Issue Policy. */
export function PaymentStep({ detail, act, setDetail }: StepProps) {
  const s = detail.submission;
  const sel = detail.versions.find((v) => v.id === detail.selectedVersionId)!;
  const total = sel.pricing?.totalCost ?? 0;
  const plan = detail.paymentPlans[s.paymentPlan] ?? detail.paymentPlans['Full Pay'];
  const canEdit = ['DRAFT', 'RATED', 'QUOTED'].includes(s.status);
  const isRenewal = s.jobType === 'Renewal';
  const down = plan.installments === 1 ? total : Math.round(total * plan.downPct);
  const each = plan.installments === 1 ? 0 : Math.round((total - down) / (plan.installments - 1)) + plan.fee;

  return (
    <>
      <BoundBanner detail={detail} />
      <div className="grid-2">
        <Panel title="Payment Plan">
          <FieldRow label="Payment Plan">
            <Select value={s.paymentPlan} readOnly={!canEdit} onChange={(v) => act('', { paymentPlan: v }, 'PUT')} options={Object.keys(detail.paymentPlans)} />
          </FieldRow>
          <FieldRow label="Billing Method">
            <Select value={s.billingMethod} readOnly={!canEdit} onChange={(v) => act('', { billingMethod: v }, 'PUT')} options={detail.billingMethods} />
          </FieldRow>
          <FieldRow label="Total Cost">{money(total)}</FieldRow>
          <FieldRow label="Due at Bind">{money(down)}</FieldRow>
          {plan.installments > 1 && <FieldRow label="Installments">{plan.installments - 1} x {money(each)} every {plan.months} month(s), including a ${plan.fee} fee</FieldRow>}
        </Panel>
        <Panel title={isRenewal ? 'Renewal Term' : 'Policy Term'}>
          <FieldRow label="Effective">{fmtDate(s.effectiveDate)}</FieldRow>
          <FieldRow label="Expiration">{fmtDate(s.expirationDate)}</FieldRow>
          <FieldRow label="Option">{sel.name}</FieldRow>
          <FieldRow label="Annual Premium">{money(sel.pricing?.premium)}</FieldRow>
          {isRenewal && detail.premiumSummary?.priorAnnualPremium !== undefined && (
            <FieldRow label="Prior Term Premium">
              {money(detail.premiumSummary.priorAnnualPremium)}
              {sel.pricing && <span className="muted"> ({(((sel.pricing.premium - detail.premiumSummary.priorAnnualPremium) / detail.premiumSummary.priorAnnualPremium) * 100).toFixed(1)}% change)</span>}
            </FieldRow>
          )}
          <FieldRow label="Producer">{detail.producer.name}</FieldRow>
        </Panel>
      </div>
      <SubjectivityChecklist detail={detail} setDetail={setDetail} />
      <Blockers detail={detail} />
      {s.status === 'QUOTED' && (
        <Panel title="Bind Options">
          <p>
            {isRenewal ? 'Issuing the renewal creates the next policy term and its installment schedule.' : 'Bind Only confirms coverage and issues a binder; the policy is issued later from the policy file. Issue Policy binds and issues the declarations in one step.'}
          </p>
          <Toolbar>
            {!isRenewal && <Button disabled={!!detail.bindBlockers.length} onClick={() => act('/bind', { issue: false })}>Bind Only</Button>}
            <Button primary disabled={!!detail.bindBlockers.length} onClick={() => act('/bind', { issue: true })}>{isRenewal ? 'Issue Renewal' : 'Issue Policy'}</Button>
          </Toolbar>
        </Panel>
      )}
      {s.status !== 'QUOTED' && s.status !== 'BOUND' && <Empty>Issue a quote before binding.</Empty>}
    </>
  );
}

/** Flatten an object to path -> value strings for a field-level comparison. */
function flatten(o: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (Array.isArray(o)) {
    o.forEach((v, i) => flatten(v, `${prefix}[${(v as any)?.number ?? (v as any)?.classCode ?? i + 1}]`, out));
  } else if (o && typeof o === 'object') {
    for (const [k, v] of Object.entries(o)) if (k !== 'id' && k !== 'locationId') flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else out[prefix] = o === undefined || o === null ? '' : String(o);
  return out;
}

const label = (path: string) =>
  path.split('.').map((seg) => seg.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())).join(' > ');

/** Show large numbers in limit/value fields as dollars. */
const show = (path: string, v: string | undefined) =>
  v && /^-?\d+(\.\d+)?$/.test(v) && Number(v) >= 1000 && !/year|squareFeet|records|count|exposure$/i.test(path) ? money(Number(v)) : v && /^-?\d+$/.test(v) ? Number(v).toLocaleString('en-US') : v;

/** Policy Review for a policy change: differences from the in-force model and the pro-rata premium. */
export function PolicyReviewStep({ detail, act }: StepProps) {
  const s = detail.submission;
  const sel = detail.versions.find((v) => v.id === detail.selectedVersionId)!;
  const base = detail.basePeriod;
  const sum = detail.premiumSummary;
  const before = base ? flatten(base.risk) : {};
  const after = flatten(sel.risk);
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => before[k] !== after[k]);

  return (
    <>
      <BoundBanner detail={detail} />
      <Panel title={`Differences from the in-force policy (model ${base?.modelNumber ?? '-'})`}>
        {!keys.length ? <Empty>No changes yet. Edit the risk or coverage steps to amend the policy.</Empty> : (
          <table className="list">
            <thead><tr><th>Field</th><th>In Force</th><th>Changed To</th></tr></thead>
            <tbody>{keys.map((k) => <tr key={k}><td>{label(k)}</td><td>{show(k, before[k]) || <em>none</em>}</td><td><b>{show(k, after[k]) || <em>removed</em>}</b></td></tr>)}</tbody>
          </table>
        )}
      </Panel>
      <Panel title="Premium Change">
        {!sum?.newAnnualPremium && sum?.newAnnualPremium !== 0 ? <Empty>Rate the change to see the premium impact.</Empty> : (
          <table className="list">
            <tbody>
              <tr><td>In-force annual premium</td><td className="r">{money(sum.priorAnnualPremium)}</td></tr>
              <tr><td>Changed annual premium</td><td className="r">{money(sum.newAnnualPremium)}</td></tr>
              <tr><td>Pro-rata factor ({sum.daysRemaining} of {sum.termDays} days remaining from {fmtDate(s.effectiveDate)})</td><td className="r">{sum.proRataFactor?.toFixed(4)}</td></tr>
              <tr className="total"><td>{(sum.transactionPremium ?? 0) >= 0 ? 'Additional premium' : 'Return premium'}</td><td className="r">{money(Math.abs(sum.transactionPremium ?? 0))}</td></tr>
              <tr><td>Written premium for the term after change</td><td className="r">{money(sum.newTermPremium)}</td></tr>
            </tbody>
          </table>
        )}
      </Panel>
      <Blockers detail={detail} />
      <Toolbar>
        {s.status === 'RATED' && <Button primary onClick={() => act('/quote')}>Quote</Button>}
        {s.status === 'QUOTED' && <Button primary disabled={!!detail.bindBlockers.length} onClick={() => act('/bind')}>Issue Policy Change</Button>}
        {s.status === 'DRAFT' && <span className="muted">Rate the change (toolbar) to quote it.</span>}
      </Toolbar>
    </>
  );
}

export function CancellationStep({ detail, act }: StepProps) {
  const s = detail.submission;
  const j = s.jobData;
  const base = detail.basePeriod;
  return (
    <>
      <BoundBanner detail={detail} />
      <div className="grid-2">
        <Panel title="Cancellation Terms">
          <FieldRow label="Source">{j.source}</FieldRow>
          <FieldRow label="Reason">{j.reason}</FieldRow>
          <FieldRow label="Refund Method">{j.method}</FieldRow>
          <FieldRow label="Cancellation Date">{fmtDate(s.effectiveDate)} at 12:01 AM</FieldRow>
          {j.noticeDays > 0 && <FieldRow label="Notice Required">{j.noticeDays} days</FieldRow>}
        </Panel>
        <Panel title="Return Premium">
          <FieldRow label="Term">{base ? `${fmtDate(base.periodStart)} - ${fmtDate(base.periodEnd)}` : '-'}</FieldRow>
          <FieldRow label="Written Premium">{money(base?.termPremium)}</FieldRow>
          <FieldRow label="Unearned Factor">{Number(j.unearnedFactor ?? 0).toFixed(4)}{j.method === 'Short Rate' && ' x 0.90 short rate'}</FieldRow>
          <FieldRow label="Return Premium"><b>{money(j.returnPremium)}</b></FieldRow>
          <FieldRow label="Earned Premium">{money((base?.termPremium ?? 0) - (j.returnPremium ?? 0))}</FieldRow>
        </Panel>
      </div>
      <Blockers detail={detail} />
      {s.status === 'QUOTED' && (
        <Toolbar>
          <Button primary danger disabled={!!detail.bindBlockers.length} onClick={() => act('/bind')}>
            {s.effectiveDate > new Date().toISOString().slice(0, 10) ? 'Schedule Cancellation' : 'Bind Cancellation'}
          </Button>
          <span className="muted">Future installments after the cancellation date are cancelled and the difference is settled on the billing account.</span>
        </Toolbar>
      )}
    </>
  );
}

export function ReinstatementStep({ detail, act }: StepProps) {
  const s = detail.submission;
  const j = s.jobData;
  const base = detail.basePeriod;
  return (
    <>
      <BoundBanner detail={detail} />
      <Panel title="Reinstatement">
        <FieldRow label="Reason">{j.reason}</FieldRow>
        <FieldRow label="Canceled Effective">{fmtDate(base?.cancellationDate)}</FieldRow>
        <FieldRow label="Reinstated Effective">{fmtDate(s.effectiveDate)} (no lapse in coverage)</FieldRow>
        <FieldRow label="Premium Reinstated">{money(j.reinstatePremium)}</FieldRow>
        <FieldRow label="Written Premium After">{money((base?.termPremium ?? 0) + (j.reinstatePremium ?? 0))}</FieldRow>
      </Panel>
      <Blockers detail={detail} />
      {s.status === 'QUOTED' && <Toolbar><Button primary disabled={!!detail.bindBlockers.length} onClick={() => act('/bind')}>Reinstate Policy</Button></Toolbar>}
    </>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtDate, money } from '../../api';
import { Button, FieldRow, Panel, Select, TextInput, Toolbar } from '../../components/ui';
import { useApp } from '../../context';
import type { StepProps } from '../SubmissionPage';

export default function PolicyInfo({ detail, act, editable }: StepProps) {
  const { producers, users } = useApp();
  const s = detail.submission;
  const a = detail.account;
  const canEdit = editable || s.status === 'INTAKE' || s.status === 'CLEARANCE_REFERRAL';
  const initial = { effectiveDate: s.effectiveDate, producerId: s.producerId, underwriterId: s.underwriterId ?? 0, priority: s.priority, description: s.description };
  const [form, setForm] = useState(initial);
  useEffect(() => setForm(initial), [detail]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = JSON.stringify(form) !== JSON.stringify(initial);

  return (
    <>
      <Panel title="Policy Information" actions={canEdit && changed && <Button primary onClick={() => act('', { ...form, underwriterId: form.underwriterId || null }, 'PUT')}>Update Policy Info</Button>}>
        <div className="grid-2">
          <div>
            <FieldRow label="Effective Date" required><TextInput type="date" value={form.effectiveDate} onChange={(v) => setForm({ ...form, effectiveDate: v })} readOnly={!canEdit} /></FieldRow>
            <FieldRow label="Expiration Date">{fmtDate(s.expirationDate)} (12 months)</FieldRow>
            <FieldRow label="Term Type">Annual</FieldRow>
            <FieldRow label="Producer of Record" required>
              <Select value={form.producerId} readOnly={!canEdit} onChange={(v) => setForm({ ...form, producerId: v })} options={producers.filter((p) => p.active || p.id === s.producerId).map((p) => ({ value: p.id, label: `${p.code} - ${p.name}` }))} />
            </FieldRow>
            <FieldRow label="Commission">{detail.producer.commissionPct}%</FieldRow>
          </div>
          <div>
            <FieldRow label="Underwriter">
              <Select value={form.underwriterId} readOnly={!canEdit} placeholder="<unassigned>" onChange={(v) => setForm({ ...form, underwriterId: v })} options={users.filter((u) => u.authorityLevel >= 1 && u.role !== 'Administrator').map((u) => ({ value: u.id, label: `${u.name} (L${u.authorityLevel})` }))} />
            </FieldRow>
            <FieldRow label="Priority"><Select value={form.priority} readOnly={!canEdit} onChange={(v) => setForm({ ...form, priority: v })} options={['Low', 'Normal', 'High', 'Rush'] as ('Low' | 'Normal' | 'High' | 'Rush')[]} /></FieldRow>
            <FieldRow label="Source">{s.source}</FieldRow>
            <FieldRow label="Received">{fmtDate(s.receivedDate)}</FieldRow>
          </div>
        </div>
        <FieldRow label="Broker Notes">
          {canEdit ? <textarea className="input textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /> : <span className="ro">{s.description || '-'}</span>}
        </FieldRow>
      </Panel>
      <Panel title="Primary Named Insured" actions={<Link to={`/accounts/${a.id}`}>Edit on account</Link>}>
        <div className="grid-2">
          <div>
            <FieldRow label="Name">{a.name}{a.dba ? ` dba ${a.dba}` : ''}</FieldRow>
            <FieldRow label="FEIN">{a.fein || '-'}</FieldRow>
            <FieldRow label="Organization Type">{a.entityType}</FieldRow>
            <FieldRow label="Industry">{a.naics} - {a.industry}</FieldRow>
          </div>
          <div>
            <FieldRow label="Address">{a.address1}<br />{a.city}, {a.state} {a.zip}</FieldRow>
            <FieldRow label="Revenue">{money(a.annualRevenue)}</FieldRow>
            <FieldRow label="Contact">{a.contactName} {a.contactEmail && `<${a.contactEmail}>`}</FieldRow>
          </div>
        </div>
      </Panel>
      {canEdit && changed && <Toolbar><span className="muted">Changing the effective date or producer requires re-rating.</span></Toolbar>}
    </>
  );
}

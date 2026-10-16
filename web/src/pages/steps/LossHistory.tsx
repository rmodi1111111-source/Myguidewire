import { money, type Loss } from '../../api';
import { Button, Empty, NumberInput, Panel, Select, TextInput, Toolbar } from '../../components/ui';
import type { StepProps } from '../SubmissionPage';

const TYPES: Record<string, string[]> = {
  CYBER: ['Ransomware', 'Data Breach', 'Business Email Compromise', 'Funds Transfer Fraud', 'Privacy Liability', 'System Outage'],
  PROPERTY: ['Fire', 'Wind / Hail', 'Water Damage', 'Theft', 'Vandalism', 'Collapse', 'Flood'],
  GL: ['Premises - Slip & Fall', 'Products Liability', 'Completed Operations', 'Property Damage', 'Personal & Advertising Injury'],
};

export default function LossHistory({ risk, setRisk, editable, detail }: StepProps) {
  const update = (i: number, patch: Partial<Loss>) => setRisk({ ...risk, losses: risk.losses.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const add = () => setRisk({ ...risk, noLossesCertified: false, losses: [...risk.losses, { date: '', type: TYPES[detail.submission.product][0], description: '', paid: 0, reserved: 0, status: 'Closed' }] });
  const total = risk.losses.reduce((s, l) => s + (l.paid || 0) + (l.reserved || 0), 0);
  return (
    <Panel title="Prior Losses - 5 years">
      <label className="checkbox">
        <input type="checkbox" disabled={!editable || risk.losses.length > 0} checked={risk.noLossesCertified} onChange={(e) => setRisk({ ...risk, noLossesCertified: e.target.checked })} />
        Insured certifies no losses in the past 5 years (loss runs received)
      </label>
      {!risk.losses.length ? <Empty>No losses entered.</Empty> : (
        <table className="list edit">
          <thead><tr><th style={{ width: 150 }}>Date of Loss</th><th style={{ width: 200 }}>Type</th><th>Description</th><th style={{ width: 130 }}>Paid</th><th style={{ width: 130 }}>Reserved</th><th style={{ width: 100 }}>Status</th><th /></tr></thead>
          <tbody>
            {risk.losses.map((l, i) => (
              <tr key={i}>
                <td><TextInput type="date" value={l.date} readOnly={!editable} onChange={(v) => update(i, { date: v })} /></td>
                <td><Select value={l.type} readOnly={!editable} onChange={(v) => update(i, { type: v })} options={TYPES[detail.submission.product]} /></td>
                <td><TextInput value={l.description} readOnly={!editable} onChange={(v) => update(i, { description: v })} /></td>
                <td><NumberInput money value={l.paid} readOnly={!editable} onChange={(v) => update(i, { paid: v })} width={100} /></td>
                <td><NumberInput money value={l.reserved} readOnly={!editable} onChange={(v) => update(i, { reserved: v })} width={100} /></td>
                <td><Select value={l.status} readOnly={!editable} onChange={(v) => update(i, { status: v })} options={['Open', 'Closed'] as Loss['status'][]} /></td>
                <td className="r">{editable && <Button onClick={() => setRisk({ ...risk, losses: risk.losses.filter((_, j) => j !== i) })}>Remove</Button>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={3} className="r"><b>Total incurred</b></td><td colSpan={2}><b>{money(total)}</b></td><td colSpan={2} /></tr></tfoot>
        </table>
      )}
      {editable && <Toolbar><Button onClick={add}>Add Loss</Button></Toolbar>}
    </Panel>
  );
}

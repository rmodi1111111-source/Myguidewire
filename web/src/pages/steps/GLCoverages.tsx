import { money, type GLRisk } from '../../api';
import { FieldRow, Panel, Select, YesNo } from '../../components/ui';
import { useApp } from '../../context';
import ScheduleRating from './ScheduleRating';
import type { StepProps } from '../SubmissionPage';

export default function GLCoverages(props: StepProps) {
  const { risk, setRisk, editable } = props;
  const { ref } = useApp();
  const r = risk as GLRisk;
  const c = r.coverages;
  const set = <K extends keyof GLRisk['coverages']>(k: K, v: GLRisk['coverages'][K]) => setRisk({ ...r, coverages: { ...c, [k]: v } });
  const ro = !editable;
  const lim = ref.gl.limitOptions[c.limitOption];
  return (
    <>
      <Panel title="Commercial General Liability - Occurrence Form">
        <div className="grid-2">
          <div>
            <FieldRow label="Occurrence / Aggregate" required>
              <Select value={c.limitOption} readOnly={ro} onChange={(v) => set('limitOption', v)} options={Object.entries(ref.gl.limitOptions).map(([k, l]) => ({ value: k, label: `${money(l.occurrence)} / ${money(l.aggregate)}` }))} />
            </FieldRow>
            <FieldRow label="Products-Completed Ops Aggregate">{money(lim?.aggregate)}</FieldRow>
            <FieldRow label="Personal & Advertising Injury"><Select value={c.personalAdvInjury} readOnly={ro} onChange={(v) => set('personalAdvInjury', v)} options={[500_000, 1_000_000, 2_000_000].map((x) => ({ value: x, label: money(x) }))} /></FieldRow>
          </div>
          <div>
            <FieldRow label="Damage to Rented Premises"><Select value={c.damageToRented} readOnly={ro} onChange={(v) => set('damageToRented', v)} options={[100_000, 300_000, 500_000].map((x) => ({ value: x, label: money(x) }))} /></FieldRow>
            <FieldRow label="Medical Expense"><Select value={c.medPay} readOnly={ro} onChange={(v) => set('medPay', v)} options={[0, 5_000, 10_000].map((x) => ({ value: x, label: x ? money(x) : 'Excluded' }))} /></FieldRow>
            <FieldRow label="BI/PD Deductible"><Select value={c.deductible} readOnly={ro} onChange={(v) => set('deductible', v)} options={ref.gl.deductibles.map((x) => ({ value: x, label: x ? money(x) : 'None' }))} /></FieldRow>
          </div>
        </div>
      </Panel>
      <Panel title="Endorsements">
        <FieldRow label="Hired & Non-Owned Auto"><YesNo value={c.hiredNonOwnedAuto} readOnly={ro} onChange={(v) => set('hiredNonOwnedAuto', v)} /></FieldRow>
        <FieldRow label="Blanket Additional Insured"><YesNo value={c.blanketAdditionalInsured} readOnly={ro} onChange={(v) => set('blanketAdditionalInsured', v)} /></FieldRow>
        <FieldRow label="Blanket Waiver of Subrogation"><YesNo value={c.waiverOfSubrogation} readOnly={ro} onChange={(v) => set('waiverOfSubrogation', v)} /></FieldRow>
        <FieldRow label="Terrorism (TRIA)"><YesNo value={c.terrorism} readOnly={ro} onChange={(v) => set('terrorism', v)} /></FieldRow>
      </Panel>
      <ScheduleRating {...props} />
    </>
  );
}

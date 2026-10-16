import { money, type PropertyRisk } from '../../api';
import { FieldRow, Panel, Select, YesNo } from '../../components/ui';
import { useApp } from '../../context';
import ScheduleRating from './ScheduleRating';
import type { StepProps } from '../SubmissionPage';

export default function PropertyCoverages(props: StepProps) {
  const { risk, setRisk, editable } = props;
  const { ref } = useApp();
  const r = risk as PropertyRisk;
  const c = r.coverages;
  const set = <K extends keyof PropertyRisk['coverages']>(k: K, v: PropertyRisk['coverages'][K]) => setRisk({ ...r, coverages: { ...c, [k]: v } });
  const ro = !editable;
  return (
    <>
      <Panel title="Policy Coverage Terms">
        <div className="grid-2">
          <div>
            <FieldRow label="Cause of Loss Form" required><Select value={c.causeOfLoss} readOnly={ro} onChange={(v) => set('causeOfLoss', v)} options={['Basic', 'Broad', 'Special'] as PropertyRisk['coverages']['causeOfLoss'][]} /></FieldRow>
            <FieldRow label="Valuation" required><Select value={c.valuation} readOnly={ro} onChange={(v) => set('valuation', v)} options={[{ value: 'RC', label: 'Replacement Cost' }, { value: 'ACV', label: 'Actual Cash Value' }] as { value: 'RC' | 'ACV'; label: string }[]} /></FieldRow>
            <FieldRow label="Coinsurance" required><Select value={c.coinsurance} readOnly={ro} onChange={(v) => set('coinsurance', v)} options={[80, 90, 100].map((x) => ({ value: x, label: `${x}%` }))} /></FieldRow>
          </div>
          <div>
            <FieldRow label="AOP Deductible" required><Select value={c.aopDeductible} readOnly={ro} onChange={(v) => set('aopDeductible', v)} options={ref.property.aopDeductibles.map((d) => ({ value: d, label: money(d) }))} /></FieldRow>
            <FieldRow label="Wind / Hail Deductible"><Select value={c.windHailDeductiblePct} readOnly={ro} onChange={(v) => set('windHailDeductiblePct', v)} options={ref.property.windHailDeductibles.map((d) => ({ value: d, label: d ? `${d}% of TIV` : 'AOP applies' }))} /></FieldRow>
          </div>
        </div>
      </Panel>
      <Panel title="Additional Coverages">
        <FieldRow label="Earthquake"><YesNo value={c.earthquake} readOnly={ro} onChange={(v) => set('earthquake', v)} /></FieldRow>
        <FieldRow label="Equipment Breakdown"><YesNo value={c.equipmentBreakdown} readOnly={ro} onChange={(v) => set('equipmentBreakdown', v)} /></FieldRow>
        <FieldRow label="Terrorism (TRIA)" hint="Offer is mandatory; insured may reject"><YesNo value={c.terrorism} readOnly={ro} onChange={(v) => set('terrorism', v)} /></FieldRow>
      </Panel>
      <ScheduleRating {...props} />
    </>
  );
}

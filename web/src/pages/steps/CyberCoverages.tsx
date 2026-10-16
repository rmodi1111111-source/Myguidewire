import { money, type CyberRisk } from '../../api';
import { FieldRow, Panel, Select, YesNo } from '../../components/ui';
import { useApp } from '../../context';
import ScheduleRating from './ScheduleRating';
import type { StepProps } from '../SubmissionPage';

export default function CyberCoverages(props: StepProps) {
  const { risk, setRisk, editable } = props;
  const { ref } = useApp();
  const r = risk as CyberRisk;
  const c = r.coverages;
  const set = <K extends keyof CyberRisk['coverages']>(k: K, v: CyberRisk['coverages'][K]) => setRisk({ ...r, coverages: { ...c, [k]: v } });
  const ro = !editable;
  return (
    <>
      <Panel title="Policy Limits">
        <FieldRow label="Aggregate Limit" required><Select value={c.aggregateLimit} readOnly={ro} onChange={(v) => set('aggregateLimit', v)} options={ref.cyber.limits.map((l) => ({ value: l, label: money(l) }))} /></FieldRow>
        <FieldRow label="Retention" required><Select value={c.retention} readOnly={ro} onChange={(v) => set('retention', v)} options={ref.cyber.retentions.map((l) => ({ value: l, label: money(l) }))} /></FieldRow>
        <FieldRow label="BI Waiting Period"><Select value={c.biWaitingHours} readOnly={ro} onChange={(v) => set('biWaitingHours', v)} options={[8, 12, 24].map((h) => ({ value: h, label: `${h} hours` }))} /></FieldRow>
      </Panel>
      <Panel title="Ransomware">
        <FieldRow label="Ransomware Sublimit" hint="Percentage of the aggregate limit available for extortion and ransomware-related loss">
          <Select value={c.ransomwareSublimitPct} readOnly={ro} onChange={(v) => set('ransomwareSublimitPct', v as 100 | 50)} options={[{ value: 100, label: `100% (${money(c.aggregateLimit)})` }, { value: 50, label: `50% (${money(c.aggregateLimit / 2)})` }]} />
        </FieldRow>
        <FieldRow label="Ransomware Coinsurance"><Select value={c.ransomwareCoinsurancePct} readOnly={ro} onChange={(v) => set('ransomwareCoinsurancePct', v as 0 | 50)} options={[{ value: 0, label: 'None' }, { value: 50, label: '50% insured participation' }]} /></FieldRow>
      </Panel>
      <Panel title="Optional Coverages">
        <FieldRow label="Social Engineering Fraud"><Select value={c.socialEngineeringLimit} readOnly={ro} onChange={(v) => set('socialEngineeringLimit', v)} options={ref.cyber.seLimits.map((l) => ({ value: l, label: l ? money(l) : 'Not covered' }))} /></FieldRow>
        <FieldRow label="Regulatory Fines & Penalties"><YesNo value={c.regulatoryFines} readOnly={ro} onChange={(v) => set('regulatoryFines', v)} /></FieldRow>
        <FieldRow label="Dependent Business Interruption"><YesNo value={c.dependentBI} readOnly={ro} onChange={(v) => set('dependentBI', v)} /></FieldRow>
        <FieldRow label="Media Liability"><YesNo value={c.mediaLiability} readOnly={ro} onChange={(v) => set('mediaLiability', v)} /></FieldRow>
        <FieldRow label="PCI Fines & Assessments"><YesNo value={c.pciFines} readOnly={ro} onChange={(v) => set('pciFines', v)} /></FieldRow>
      </Panel>
      <ScheduleRating {...props} />
    </>
  );
}

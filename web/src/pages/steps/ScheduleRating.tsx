import { FieldRow, NumberInput, Panel, TextInput } from '../../components/ui';
import type { StepProps } from '../SubmissionPage';

/** Underwriter schedule rating (discretionary credit/debit), shared by all products. */
export default function ScheduleRating({ risk, setRisk, editable }: StepProps) {
  return (
    <Panel title="Schedule Rating">
      <FieldRow label="Schedule Modification %" hint="-25% to +25%. Beyond +/-10% requires senior approval; beyond +/-20% requires manager approval.">
        <NumberInput value={risk.scheduleMod} onChange={(v) => setRisk({ ...risk, scheduleMod: v })} readOnly={!editable} width={80} />
      </FieldRow>
      <FieldRow label="Justification">
        <TextInput value={risk.scheduleModReason} onChange={(v) => setRisk({ ...risk, scheduleModReason: v })} readOnly={!editable} placeholder="e.g. superior management, loss control program" />
      </FieldRow>
    </Panel>
  );
}

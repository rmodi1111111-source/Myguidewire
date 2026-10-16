import type { CyberRisk } from '../../api';
import { Panel } from '../../components/ui';
import { useApp } from '../../context';
import type { StepProps } from '../SubmissionPage';

/** Cyber qualification questionnaire (PolicyCenter "Qualification" step). */
export default function CyberQualification({ risk, setRisk, editable }: StepProps) {
  const { ref } = useApp();
  const r = risk as CyberRisk;
  const sections = [...new Set(ref.cyber.questions.map((q) => q.section))];
  const answered = ref.cyber.questions.filter((q) => r.answers[q.code]).length;
  const set = (code: string, v: string) => setRisk({ ...r, answers: { ...r.answers, [code]: v } });

  return (
    <>
      <div className="muted mb">{answered} of {ref.cyber.questions.length} questions answered. Answers drive security-control rating credits/debits and underwriting rules.</div>
      {sections.map((sec) => (
        <Panel key={sec} title={sec}>
          <table className="qtable">
            <tbody>
              {ref.cyber.questions.filter((q) => q.section === sec).map((q) => {
                const opts = q.type === 'yesno' ? ['Yes', 'No'] : q.options ?? [];
                const val = r.answers[q.code] ?? '';
                return (
                  <tr key={q.code} className={!val && q.required ? 'unanswered' : ''}>
                    <td className="qtext">{q.required && <span className="req">*</span>}{q.text}</td>
                    <td className="qans">
                      {!editable ? <span className="ro">{val || '-'}</span> : q.type === 'yesno' ? (
                        <span className="radio-group">
                          {opts.map((o) => (
                            <label key={o}><input type="radio" name={q.code} checked={val === o} onChange={() => set(q.code, o)} /> {o}</label>
                          ))}
                        </span>
                      ) : (
                        <select className="input" value={val} onChange={(e) => set(q.code, e.target.value)}>
                          <option value="">{'<select>'}</option>
                          {opts.map((o) => <option key={o}>{o}</option>)}
                        </select>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      ))}
    </>
  );
}

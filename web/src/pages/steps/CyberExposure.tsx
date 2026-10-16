import { useState } from 'react';
import type { CyberRisk } from '../../api';
import { Button, FieldRow, NumberInput, Panel, TextInput, Toolbar } from '../../components/ui';
import type { StepProps } from '../SubmissionPage';

export default function CyberExposure({ risk, setRisk, editable }: StepProps) {
  const r = risk as CyberRisk;
  const [domain, setDomain] = useState('');
  const set = <K extends keyof CyberRisk>(k: K, v: CyberRisk[K]) => setRisk({ ...r, [k]: v });
  const addDomain = () => {
    const d = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
    if (d && !r.domains.includes(d)) set('domains', [...r.domains, d]);
    setDomain('');
  };
  return (
    <>
      <Panel title="Financial Exposure">
        <FieldRow label="Annual Revenue" required hint="Prior fiscal year gross revenue - primary rating basis"><NumberInput money value={r.annualRevenue} onChange={(v) => set('annualRevenue', v)} readOnly={!editable} /></FieldRow>
        <FieldRow label="Employees"><NumberInput value={r.employeeCount} onChange={(v) => set('employeeCount', v)} readOnly={!editable} width={120} /></FieldRow>
      </Panel>
      <Panel title="Sensitive Records Held">
        <FieldRow label="PII Records" hint="SSN, driver's license, financial account numbers"><NumberInput value={r.piiRecords} onChange={(v) => set('piiRecords', v)} readOnly={!editable} width={160} /></FieldRow>
        <FieldRow label="PHI Records" hint="Protected health information (weighted x2 in rating)"><NumberInput value={r.phiRecords} onChange={(v) => set('phiRecords', v)} readOnly={!editable} width={160} /></FieldRow>
        <FieldRow label="Payment Card Records"><NumberInput value={r.pciRecords} onChange={(v) => set('pciRecords', v)} readOnly={!editable} width={160} /></FieldRow>
        <FieldRow label="Total">{(r.piiRecords + r.phiRecords + r.pciRecords).toLocaleString()}</FieldRow>
      </Panel>
      <Panel title="Internet Domains (CRP scan targets)">
        <table className="list">
          <thead><tr><th>Domain</th><th /></tr></thead>
          <tbody>
            {r.domains.map((d) => (
              <tr key={d}>
                <td>{d}</td>
                <td className="r">{editable && <Button onClick={() => set('domains', r.domains.filter((x) => x !== d))}>Remove</Button>}</td>
              </tr>
            ))}
            {!r.domains.length && <tr><td colSpan={2} className="muted">No domains - add the insured's primary web and email domains.</td></tr>}
          </tbody>
        </table>
        {editable && (
          <Toolbar>
            <TextInput value={domain} onChange={setDomain} placeholder="example.com" />
            <Button onClick={addDomain}>Add Domain</Button>
          </Toolbar>
        )}
      </Panel>
    </>
  );
}

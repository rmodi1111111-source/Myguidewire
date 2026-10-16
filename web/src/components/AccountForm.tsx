import type { Account } from '../api';
import { useApp } from '../context';
import { FieldRow, NumberInput, Select, TextInput } from './ui';

export const emptyAccount: Partial<Account> = {
  name: '', dba: '', fein: '', entityType: 'Corporation', naics: '', industry: '', address1: '', city: '', state: '', zip: '', website: '',
  yearsInBusiness: 0, annualRevenue: 0, employeeCount: 0, contactName: '', contactEmail: '', contactPhone: '',
};

export default function AccountForm({ value, onChange, readOnly }: { value: Partial<Account>; onChange: (a: Partial<Account>) => void; readOnly?: boolean }) {
  const { ref } = useApp();
  const set = <K extends keyof Account>(k: K, v: Account[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="grid-2">
      <div>
        <h4 className="subhead">Named Insured</h4>
        <FieldRow label="Name" required><TextInput value={value.name} onChange={(v) => set('name', v)} readOnly={readOnly} /></FieldRow>
        <FieldRow label="DBA"><TextInput value={value.dba} onChange={(v) => set('dba', v)} readOnly={readOnly} /></FieldRow>
        <FieldRow label="FEIN" required><TextInput value={value.fein} onChange={(v) => set('fein', v)} readOnly={readOnly} placeholder="12-3456789" /></FieldRow>
        <FieldRow label="Organization Type"><Select value={value.entityType} onChange={(v) => set('entityType', v)} readOnly={readOnly} options={ref.entityTypes} /></FieldRow>
        <FieldRow label="Industry (NAICS)" required>
          <Select
            value={value.naics}
            readOnly={readOnly}
            placeholder="<select>"
            onChange={(v) => onChange({ ...value, naics: v, industry: ref.industries.find((i) => i.naics === v)?.description ?? '' })}
            options={ref.industries.map((i) => ({ value: i.naics, label: `${i.naics} - ${i.description}` }))}
          />
        </FieldRow>
        <FieldRow label="Website"><TextInput value={value.website} onChange={(v) => set('website', v)} readOnly={readOnly} placeholder="example.com" /></FieldRow>
        <FieldRow label="Years in Business"><NumberInput value={value.yearsInBusiness} onChange={(v) => set('yearsInBusiness', v)} readOnly={readOnly} width={80} /></FieldRow>
        <FieldRow label="Annual Revenue" required><NumberInput money value={value.annualRevenue} onChange={(v) => set('annualRevenue', v)} readOnly={readOnly} /></FieldRow>
        <FieldRow label="Employees"><NumberInput value={value.employeeCount} onChange={(v) => set('employeeCount', v)} readOnly={readOnly} width={100} /></FieldRow>
      </div>
      <div>
        <h4 className="subhead">Mailing Address</h4>
        <FieldRow label="Address" required><TextInput value={value.address1} onChange={(v) => set('address1', v)} readOnly={readOnly} /></FieldRow>
        <FieldRow label="City" required><TextInput value={value.city} onChange={(v) => set('city', v)} readOnly={readOnly} /></FieldRow>
        <FieldRow label="State" required><Select value={value.state} onChange={(v) => set('state', v)} readOnly={readOnly} placeholder="<select>" options={Object.entries(ref.states).map(([k, n]) => ({ value: k, label: n }))} /></FieldRow>
        <FieldRow label="ZIP" required><TextInput value={value.zip} onChange={(v) => set('zip', v)} readOnly={readOnly} width={110} /></FieldRow>
        <h4 className="subhead">Primary Contact</h4>
        <FieldRow label="Name"><TextInput value={value.contactName} onChange={(v) => set('contactName', v)} readOnly={readOnly} /></FieldRow>
        <FieldRow label="Email"><TextInput value={value.contactEmail} onChange={(v) => set('contactEmail', v)} readOnly={readOnly} /></FieldRow>
        <FieldRow label="Phone"><TextInput value={value.contactPhone} onChange={(v) => set('contactPhone', v)} readOnly={readOnly} /></FieldRow>
      </div>
    </div>
  );
}

import type { GLRisk, Location, PropertyRisk } from '../../api';
import { Button, NumberInput, Panel, Select, TextInput, Toolbar } from '../../components/ui';
import { useApp } from '../../context';
import type { StepProps } from '../SubmissionPage';

export default function Locations({ risk, setRisk, editable, detail }: StepProps) {
  const { ref } = useApp();
  const r = risk as PropertyRisk | GLRisk;
  const isProperty = r.product === 'PROPERTY';
  const update = (id: string, patch: Partial<Location>) => setRisk({ ...r, locations: r.locations.map((l) => (l.id === id ? { ...l, ...patch } : l)) } as typeof r);
  const add = () => {
    const n = Math.max(0, ...r.locations.map((l) => l.number)) + 1;
    const loc: Location = { id: `L${Date.now().toString(36)}`, number: n, address1: '', city: '', state: detail.account.state, zip: '', protectionClass: 4 };
    setRisk({ ...r, locations: [...r.locations, loc] } as typeof r);
  };
  const remove = (id: string) => {
    if (r.product === 'PROPERTY') setRisk({ ...r, locations: r.locations.filter((l) => l.id !== id), buildings: r.buildings.filter((b) => b.locationId !== id) });
    else setRisk({ ...r, locations: r.locations.filter((l) => l.id !== id), exposures: r.exposures.filter((e) => e.locationId !== id) });
  };
  const states = Object.keys(ref.states).map((k) => ({ value: k, label: k }));
  return (
    <Panel title="Locations">
      <table className="list edit">
        <thead>
          <tr>
            <th style={{ width: 40 }}>#</th><th>Address</th><th>City</th><th style={{ width: 80 }}>State</th><th style={{ width: 90 }}>ZIP</th>
            {isProperty && <th style={{ width: 120 }}>Protection Class</th>}
            {isProperty && <th className="r">Buildings</th>}
            {!isProperty && <th className="r">Class Codes</th>}
            <th />
          </tr>
        </thead>
        <tbody>
          {r.locations.map((l) => (
            <tr key={l.id}>
              <td>{l.number}</td>
              <td><TextInput value={l.address1} onChange={(v) => update(l.id, { address1: v })} readOnly={!editable} /></td>
              <td><TextInput value={l.city} onChange={(v) => update(l.id, { city: v })} readOnly={!editable} /></td>
              <td><Select value={l.state} onChange={(v) => update(l.id, { state: v })} readOnly={!editable} options={states} placeholder="" /></td>
              <td><TextInput value={l.zip} onChange={(v) => update(l.id, { zip: v })} readOnly={!editable} /></td>
              {isProperty && <td><NumberInput value={l.protectionClass} onChange={(v) => update(l.id, { protectionClass: Math.max(1, Math.min(10, v)) })} readOnly={!editable} width={60} /></td>}
              <td className="r">{r.product === 'PROPERTY' ? r.buildings.filter((b) => b.locationId === l.id).length : r.exposures.filter((e) => e.locationId === l.id).length}</td>
              <td className="r">{editable && r.locations.length > 1 && <Button onClick={() => remove(l.id)}>Remove</Button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {editable && <Toolbar><Button onClick={add}>Add Location</Button></Toolbar>}
    </Panel>
  );
}

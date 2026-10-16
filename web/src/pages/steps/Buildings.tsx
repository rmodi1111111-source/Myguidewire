import { useState } from 'react';
import { money, type Building, type PropertyRisk } from '../../api';
import { Button, Empty, FieldRow, NumberInput, Panel, Select, TextInput, Toolbar } from '../../components/ui';
import { useApp } from '../../context';
import type { StepProps } from '../SubmissionPage';

const tiv = (b: Building) => (b.buildingValue || 0) + (b.bppValue || 0) + (b.biValue || 0);

export default function Buildings({ risk, setRisk, editable }: StepProps) {
  const { ref } = useApp();
  const r = risk as PropertyRisk;
  const [selected, setSelected] = useState<string | null>(r.buildings[0]?.id ?? null);
  const b = r.buildings.find((x) => x.id === selected);
  const update = (patch: Partial<Building>) => setRisk({ ...r, buildings: r.buildings.map((x) => (x.id === selected ? { ...x, ...patch } : x)) });
  const add = () => {
    const loc = r.locations[0];
    const n = Math.max(0, ...r.buildings.filter((x) => x.locationId === loc.id).map((x) => x.number)) + 1;
    const nb: Building = {
      id: `B${Date.now().toString(36)}`, locationId: loc.id, number: n, description: '', constructionClass: 3, occupancy: 'Office',
      yearBuilt: 2000, roofYear: 2015, stories: 1, squareFeet: 10_000, sprinklerPct: 0, alarm: 'None', occupiedPct: 100, buildingValue: 0, bppValue: 0, biValue: 0,
    };
    setRisk({ ...r, buildings: [...r.buildings, nb] });
    setSelected(nb.id);
  };
  const remove = (id: string) => {
    setRisk({ ...r, buildings: r.buildings.filter((x) => x.id !== id) });
    setSelected(null);
  };
  const ro = !editable;
  const total = r.buildings.reduce((s, x) => s + tiv(x), 0);

  return (
    <>
      <Panel title={`Buildings - Total Insured Value ${money(total)}`}>
        {!r.buildings.length ? <Empty>No buildings. Add at least one building to rate.</Empty> : (
          <table className="list">
            <thead><tr><th>Loc / Bldg</th><th>Description</th><th>Construction</th><th>Occupancy</th><th>Year</th><th>Sq Ft</th><th>Sprinklered</th><th className="r">TIV</th><th /></tr></thead>
            <tbody>
              {r.buildings.map((x) => {
                const loc = r.locations.find((l) => l.id === x.locationId);
                return (
                  <tr key={x.id} className={`clickable${x.id === selected ? ' selected' : ''}`} onClick={() => setSelected(x.id)}>
                    <td>{loc?.number ?? '?'} / {x.number}</td>
                    <td>{x.description || '-'}</td>
                    <td>{ref.property.constructionClasses[x.constructionClass]?.name}</td>
                    <td>{x.occupancy}</td>
                    <td>{x.yearBuilt}</td>
                    <td>{x.squareFeet.toLocaleString()}</td>
                    <td>{x.sprinklerPct}%</td>
                    <td className="r">{money(tiv(x))}</td>
                    <td className="r">{editable && <Button onClick={() => remove(x.id)}>Remove</Button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {editable && <Toolbar><Button onClick={add}>Add Building</Button></Toolbar>}
      </Panel>
      {b && (
        <Panel title={`Building Details - Loc ${r.locations.find((l) => l.id === b.locationId)?.number} / Bldg ${b.number}`}>
          <div className="grid-2">
            <div>
              <h4 className="subhead">Building</h4>
              <FieldRow label="Location" required>
                <Select value={b.locationId} readOnly={ro} onChange={(v) => update({ locationId: v })} options={r.locations.map((l) => ({ value: l.id, label: `${l.number}: ${l.address1 || '(no address)'}, ${l.city} ${l.state}` }))} />
              </FieldRow>
              <FieldRow label="Description"><TextInput value={b.description} readOnly={ro} onChange={(v) => update({ description: v })} /></FieldRow>
              <FieldRow label="Construction" required>
                <Select value={b.constructionClass} readOnly={ro} onChange={(v) => update({ constructionClass: v })} options={Object.entries(ref.property.constructionClasses).map(([k, c]) => ({ value: Number(k), label: `${k} - ${c.name}` }))} />
              </FieldRow>
              <FieldRow label="Occupancy" required>
                <Select value={b.occupancy} readOnly={ro} onChange={(v) => update({ occupancy: v })} options={Object.keys(ref.property.occupancies)} />
              </FieldRow>
              <FieldRow label="Year Built" required><NumberInput value={b.yearBuilt} readOnly={ro} onChange={(v) => update({ yearBuilt: v })} width={80} /></FieldRow>
              <FieldRow label="Roof Year"><NumberInput value={b.roofYear} readOnly={ro} onChange={(v) => update({ roofYear: v })} width={80} /></FieldRow>
              <FieldRow label="Stories"><NumberInput value={b.stories} readOnly={ro} onChange={(v) => update({ stories: v })} width={60} /></FieldRow>
              <FieldRow label="Square Feet"><NumberInput value={b.squareFeet} readOnly={ro} onChange={(v) => update({ squareFeet: v })} width={120} /></FieldRow>
            </div>
            <div>
              <h4 className="subhead">Protection</h4>
              <FieldRow label="Sprinklered %"><NumberInput value={b.sprinklerPct} readOnly={ro} onChange={(v) => update({ sprinklerPct: Math.max(0, Math.min(100, v)) })} width={60} /></FieldRow>
              <FieldRow label="Alarm"><Select value={b.alarm} readOnly={ro} onChange={(v) => update({ alarm: v })} options={['None', 'Local', 'Central Station'] as Building['alarm'][]} /></FieldRow>
              <FieldRow label="Occupied %"><NumberInput value={b.occupiedPct} readOnly={ro} onChange={(v) => update({ occupiedPct: Math.max(0, Math.min(100, v)) })} width={60} /></FieldRow>
              <h4 className="subhead">Limits</h4>
              <FieldRow label="Building Limit"><NumberInput money value={b.buildingValue} readOnly={ro} onChange={(v) => update({ buildingValue: v })} /></FieldRow>
              <FieldRow label="Business Personal Property"><NumberInput money value={b.bppValue} readOnly={ro} onChange={(v) => update({ bppValue: v })} /></FieldRow>
              <FieldRow label="Business Income / EE"><NumberInput money value={b.biValue} readOnly={ro} onChange={(v) => update({ biValue: v })} /></FieldRow>
              <FieldRow label="Building TIV">{money(tiv(b))}</FieldRow>
            </div>
          </div>
        </Panel>
      )}
    </>
  );
}

import type { GLExposure, GLRisk } from '../../api';
import { Button, Empty, NumberInput, Panel, Select, Toolbar } from '../../components/ui';
import { useApp } from '../../context';
import type { StepProps } from '../SubmissionPage';

export default function GLExposures({ risk, setRisk, editable }: StepProps) {
  const { ref } = useApp();
  const r = risk as GLRisk;
  const update = (id: string, patch: Partial<GLExposure>) => setRisk({ ...r, exposures: r.exposures.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
  const add = () => setRisk({ ...r, exposures: [...r.exposures, { id: `E${Date.now().toString(36)}`, locationId: r.locations[0].id, classCode: '', exposure: 0 }] });
  return (
    <Panel title="Exposures by Class Code">
      {!r.exposures.length ? <Empty>No exposures. Add the classification(s) that describe the insured's operations.</Empty> : (
        <table className="list edit">
          <thead><tr><th style={{ width: 160 }}>Location</th><th>Class Code</th><th style={{ width: 90 }}>Basis</th><th style={{ width: 170 }}>Exposure</th><th style={{ width: 90 }}>Hazard</th><th /></tr></thead>
          <tbody>
            {r.exposures.map((e) => {
              const cls = ref.gl.classes.find((c) => c.code === e.classCode);
              return (
                <tr key={e.id}>
                  <td><Select value={e.locationId} readOnly={!editable} onChange={(v) => update(e.id, { locationId: v })} options={r.locations.map((l) => ({ value: l.id, label: `${l.number}: ${l.city || l.address1 || '-'} ${l.state}` }))} /></td>
                  <td><Select value={e.classCode} readOnly={!editable} placeholder="<select class>" onChange={(v) => update(e.id, { classCode: v })} options={ref.gl.classes.map((c) => ({ value: c.code, label: `${c.code} - ${c.description}` }))} /></td>
                  <td>{cls?.basis ?? '-'}</td>
                  <td>
                    <NumberInput money={cls?.basis !== 'Area'} value={e.exposure} readOnly={!editable} onChange={(v) => update(e.id, { exposure: v })} width={130} />
                    {cls?.basis === 'Area' && <span className="muted"> sq ft</span>}
                  </td>
                  <td><span className={`hazard hazard-${(cls?.hazard ?? '').toLowerCase()}`}>{cls?.hazard ?? '-'}</span></td>
                  <td className="r">{editable && <Button onClick={() => setRisk({ ...r, exposures: r.exposures.filter((x) => x.id !== e.id) })}>Remove</Button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {editable && <Toolbar><Button onClick={add}>Add Exposure</Button></Toolbar>}
    </Panel>
  );
}

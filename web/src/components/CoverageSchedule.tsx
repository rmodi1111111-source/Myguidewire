import { money, type RiskData } from '../api';
import { useApp } from '../context';

/** Declarations-style coverage schedule for any product, shared by quote proposals and policy documents. */
export default function CoverageSchedule({ risk: r }: { risk: RiskData }) {
  const { ref } = useApp();
  return (
    <div className="table-scroll">
      {r.product === 'CYBER' && (
        <table className="list">
          <thead><tr><th>Insuring Agreement</th><th className="r">Limit</th><th className="r">Retention</th></tr></thead>
          <tbody>
            {[
              ['Policy Aggregate Limit of Liability', money(r.coverages.aggregateLimit), money(r.coverages.retention)],
              ['Privacy & Network Security Liability', money(r.coverages.aggregateLimit), money(r.coverages.retention)],
              ['Regulatory Proceedings, Fines & Penalties', r.coverages.regulatoryFines ? money(r.coverages.aggregateLimit) : 'Not Covered', money(r.coverages.retention)],
              ['Breach Response Costs', money(r.coverages.aggregateLimit), money(r.coverages.retention)],
              [`Business Interruption (${r.coverages.biWaitingHours}-hour waiting period)`, money(r.coverages.aggregateLimit), `${r.coverages.biWaitingHours} hours`],
              [`Cyber Extortion / Ransomware${r.coverages.ransomwareCoinsurancePct ? ` (${r.coverages.ransomwareCoinsurancePct}% coinsurance)` : ''}`, money((r.coverages.aggregateLimit * r.coverages.ransomwareSublimitPct) / 100), money(r.coverages.retention)],
              ['Social Engineering Fraud', r.coverages.socialEngineeringLimit ? money(r.coverages.socialEngineeringLimit) : 'Not Covered', r.coverages.socialEngineeringLimit ? money(r.coverages.retention) : '-'],
              ['Dependent Business Interruption', r.coverages.dependentBI ? money(r.coverages.aggregateLimit) : 'Not Covered', '-'],
              ['Media Liability', r.coverages.mediaLiability ? money(r.coverages.aggregateLimit) : 'Not Covered', '-'],
              ['PCI Fines & Assessments', r.coverages.pciFines ? money(Math.min(r.coverages.aggregateLimit, 500_000)) : 'Not Covered', '-'],
            ].map(([k, l, d]) => <tr key={k}><td>{k}</td><td className="r">{l}</td><td className="r">{d}</td></tr>)}
          </tbody>
        </table>
      )}
      {r.product === 'PROPERTY' && (
        <>
          <p>
            Cause of loss: <b>{r.coverages.causeOfLoss}</b>. Valuation: <b>{r.coverages.valuation === 'RC' ? 'Replacement Cost' : 'Actual Cash Value'}</b>. Coinsurance: <b>{r.coverages.coinsurance}%</b>.
            AOP deductible: <b>{money(r.coverages.aopDeductible)}</b>. Wind/hail: <b>{r.coverages.windHailDeductiblePct ? `${r.coverages.windHailDeductiblePct}% of TIV` : 'AOP applies'}</b>.
            Earthquake: <b>{r.coverages.earthquake ? 'Included' : 'Excluded'}</b>. Equipment breakdown: <b>{r.coverages.equipmentBreakdown ? 'Included' : 'Excluded'}</b>. Terrorism: <b>{r.coverages.terrorism ? 'Included' : 'Rejected'}</b>.
          </p>
          <table className="list">
            <thead><tr><th>Loc / Bldg</th><th>Address / Description</th><th>Construction</th><th className="r">Building</th><th className="r">BPP</th><th className="r">BI/EE</th></tr></thead>
            <tbody>
              {r.buildings.map((b) => {
                const loc = r.locations.find((l) => l.id === b.locationId);
                return (
                  <tr key={b.id}>
                    <td>{loc?.number} / {b.number}</td>
                    <td>{loc?.address1}, {loc?.city} {loc?.state}<br /><span className="muted">{b.description || b.occupancy}</span></td>
                    <td>{ref.property.constructionClasses[b.constructionClass]?.name}</td>
                    <td className="r">{money(b.buildingValue)}</td><td className="r">{money(b.bppValue)}</td><td className="r">{money(b.biValue)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
      {r.product === 'GL' && (
        <>
          <table className="list">
            <thead><tr><th>Coverage</th><th className="r">Limit</th></tr></thead>
            <tbody>
              <tr><td>Each Occurrence / General Aggregate</td><td className="r">{r.coverages.limitOption}</td></tr>
              <tr><td>Personal & Advertising Injury</td><td className="r">{money(r.coverages.personalAdvInjury)}</td></tr>
              <tr><td>Damage to Premises Rented to You</td><td className="r">{money(r.coverages.damageToRented)}</td></tr>
              <tr><td>Medical Expense</td><td className="r">{r.coverages.medPay ? money(r.coverages.medPay) : 'Excluded'}</td></tr>
              <tr><td>BI/PD Deductible</td><td className="r">{r.coverages.deductible ? money(r.coverages.deductible) : 'None'}</td></tr>
              <tr><td>Hired & Non-Owned Auto</td><td className="r">{r.coverages.hiredNonOwnedAuto ? 'Included' : 'Not Covered'}</td></tr>
            </tbody>
          </table>
          <table className="list">
            <thead><tr><th>Loc</th><th>Class</th><th>Description</th><th className="r">Exposure</th></tr></thead>
            <tbody>
              {r.exposures.map((e) => {
                const cls = ref.gl.classes.find((c) => c.code === e.classCode);
                return (
                  <tr key={e.id}>
                    <td>{r.locations.find((l) => l.id === e.locationId)?.number}</td><td>{e.classCode}</td><td>{cls?.description}</td>
                    <td className="r">{cls?.basis === 'Area' ? `${e.exposure.toLocaleString()} sq ft` : `${money(e.exposure)} ${cls?.basis.toLowerCase()}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
            </div>
  );
}

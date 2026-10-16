import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { STANDALONE, api, fmtDate, money, type QuoteSnapshot } from '../api';
import { Messages, StatusBadge, Toolbar } from '../components/ui';
import { useApp } from '../context';

const CARRIER = 'Summit Ridge Insurance Company';

interface QuoteData {
  id: number;
  submissionId: number;
  status: string;
  snapshot: QuoteSnapshot;
}

/** On-screen quote proposal, the same content as the PDF document. */
export default function QuoteProposal() {
  const { id } = useParams();
  const { ref } = useApp();
  const [data, setData] = useState<QuoteData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<QuoteData>(`/quotes/${id}`).then(setData).catch((e) => setError(e.message));
  }, [id]);
  if (!data) return <div className="content-pad"><Messages errors={error ? [error] : []} infos={error ? [] : ['Loading...']} /></div>;

  const s = data.snapshot;
  const a = s.account;
  const p = s.pricing;
  const r = s.risk;

  return (
    <div className="content-pad">
      <Toolbar>
        <Link className="btn" to={`/submissions/${data.submissionId}/quote`}>&lt; Back to submission</Link>
        <StatusBadge status={data.status === 'Active' ? 'QUOTED' : 'WITHDRAWN'} label={data.status} />
        {!STANDALONE && <a className="btn" href={`/api/quotes/${data.id}/pdf`} target="_blank" rel="noreferrer">Open as PDF</a>}
      </Toolbar>
      <article className="proposal">
        <header className="proposal-head">
          <div>
            <div className="proposal-carrier">{CARRIER}</div>
            <div>{s.productName} - Quote Proposal</div>
          </div>
          <div className="proposal-num">
            <b>{s.quoteNumber}</b>
            <div>Issued {fmtDate(s.issuedAt)}</div>
            <div>Valid until {fmtDate(s.validUntil)}</div>
          </div>
        </header>
        <p className="proposal-disclaimer">
          This is a quotation only. It is not a binder, policy or certificate of insurance. Coverage is not in force until bound in writing by the company and all subjectivities are satisfied.
        </p>

        <h2>Quote Information</h2>
        <dl className="proposal-grid">
          <dt>Named Insured</dt><dd>{a.name}{a.dba ? ` dba ${a.dba}` : ''}</dd>
          <dt>Submission #</dt><dd>{s.jobNumber}</dd>
          <dt>Mailing Address</dt><dd>{a.address1}, {a.city}, {a.state} {a.zip}</dd>
          <dt>Account #</dt><dd>{a.accountNumber}</dd>
          <dt>Policy Period</dt><dd>{fmtDate(s.effectiveDate)} to {fmtDate(s.expirationDate)}, 12:01 AM standard time</dd>
          <dt>Option</dt><dd>{s.versionName}</dd>
          <dt>Producer</dt><dd>{s.producer.name} ({s.producer.code})</dd>
          <dt>Underwriter</dt><dd>{s.underwriter ? `${s.underwriter.name}, ${s.underwriter.email}` : '-'}</dd>
          <dt>Business</dt><dd>{a.industry || a.naics}</dd>
          <dt>Annual Revenue</dt><dd>{money(a.annualRevenue)}</dd>
          {s.scan && <><dt>CRP Risk Score</dt><dd>{s.scan.compositeScore} (Grade {s.scan.grade})</dd></>}
        </dl>

        <h2>Coverage Schedule</h2>
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

        <h2>Premium Summary</h2>
        <div className="table-scroll">
          <table className="list">
            <tbody>
              {p.lines.map((l) => <tr key={l.coverage}><td>{l.coverage}</td><td className="r">{money(l.premium)}</td></tr>)}
              <tr className="total"><td>Total Premium</td><td className="r">{money(p.premium)}</td></tr>
              {p.taxesAndFees.map((t) => <tr key={t.label}><td>{t.label}</td><td className="r">{money(t.amount)}</td></tr>)}
              <tr className="total grand"><td>Total Cost</td><td className="r">{money(p.totalCost)}</td></tr>
            </tbody>
          </table>
        </div>
        <p className="muted">Producer commission: {s.producer.commissionPct}%.</p>

        <h2>Subjectivities</h2>
        <p className="muted">To be received prior to binding unless otherwise stated.</p>
        <ol>{s.subjectivities.map((x) => <li key={x}>{x}</li>)}</ol>

        <h2>Forms & Endorsements</h2>
        <div className="table-scroll">
          <table className="list">
            <thead><tr><th>Form Number</th><th>Title</th></tr></thead>
            <tbody>{s.forms.map((f) => <tr key={f.number}><td className="nowrap">{f.number}</td><td>{f.title}</td></tr>)}</tbody>
          </table>
        </div>

        <h2>Terms & Conditions</h2>
        <p>This quotation is valid until {fmtDate(s.validUntil)} and is based on the information provided in the application and supplemental materials. Any material change in the risk prior to binding may result in a revised quotation or withdrawal of this offer.</p>
        <p>Coverage is provided solely under the terms, conditions, limitations and exclusions of the policy forms listed above. If this proposal and the policy conflict, the policy governs.</p>
        <p>Binding instructions must be received in writing from the producer of record. This proposal does not bind coverage.</p>
      </article>
    </div>
  );
}

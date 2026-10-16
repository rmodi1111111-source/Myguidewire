import { useState } from 'react';
import { money } from '../api';
import { PageTitle, Panel, Tabs } from '../components/ui';
import { useApp } from '../context';

type Tab = 'users' | 'producers' | 'appetite' | 'rating' | 'sanctions';

export default function Admin() {
  const { users, producers, ref } = useApp();
  const [tab, setTab] = useState<Tab>('users');
  const products = ref.products as unknown as Record<string, { name: string; minimumPremium: number; policyFee: number; appetite: { declinedNaics: Record<string, string>; referredNaics: Record<string, string>; excludedStates: string[]; maxRevenueRefer?: number; maxRevenueDecline?: number; minYearsInBusiness?: number } }>;
  return (
    <div className="content-pad">
      <PageTitle sub="Reference configuration (read-only in this build)">Administration</PageTitle>
      <Tabs
        tabs={[
          { key: 'users', label: 'Users & Authority' },
          { key: 'producers', label: 'Producers' },
          { key: 'appetite', label: 'Appetite' },
          { key: 'rating', label: 'Rating Tables' },
          { key: 'sanctions', label: 'Sanctions List' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'users' && (
        <Panel title="Users">
          <table className="list">
            <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Authority Level</th><th>Email</th></tr></thead>
            <tbody>{users.map((u) => <tr key={u.id}><td>{u.name}</td><td>{u.username}</td><td>{u.role}</td><td>{u.authorityLevel}</td><td>{u.email}</td></tr>)}</tbody>
          </table>
          <div className="muted mt">
            Authority levels: 0 = intake only (create submissions, run clearance); 1 = underwriter (decline, approve level-1 issues);
            2 = senior underwriter (clearance referrals, level-2 issues, reopen); 3 = manager (clearance declines, level-3 issues).
          </div>
        </Panel>
      )}
      {tab === 'producers' && (
        <Panel title="Producers / Agencies">
          <table className="list">
            <thead><tr><th>Code</th><th>Name</th><th>Contact</th><th>Location</th><th>Commission</th><th>Licensed States</th><th>Status</th></tr></thead>
            <tbody>
              {producers.map((p) => (
                <tr key={p.id}><td>{p.code}</td><td>{p.name}</td><td>{p.contactName}<br /><span className="muted">{p.email}</span></td><td>{p.city}, {p.state}</td><td>{p.commissionPct}%</td><td className="wrap">{p.licensedStates.join(', ')}</td><td>{p.active ? 'Active' : 'Terminated'}</td></tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
      {tab === 'appetite' && Object.entries(products).map(([code, p]) => (
        <Panel key={code} title={`${p.name} - minimum premium ${money(p.minimumPremium)}, policy fee ${money(p.policyFee)}`}>
          <table className="list">
            <thead><tr><th>Rule</th><th>Outcome</th><th>Detail</th></tr></thead>
            <tbody>
              {Object.entries(p.appetite.declinedNaics).map(([n, d]) => <tr key={`d${n}`}><td>NAICS {n}</td><td>Decline</td><td>{d}</td></tr>)}
              {Object.entries(p.appetite.referredNaics).map(([n, d]) => <tr key={`r${n}`}><td>NAICS {n}</td><td>Refer</td><td>{d}</td></tr>)}
              {p.appetite.excludedStates.length > 0 && <tr><td>States</td><td>Decline</td><td>Not written in {p.appetite.excludedStates.join(', ')}</td></tr>}
              {p.appetite.maxRevenueRefer && <tr><td>Revenue</td><td>Refer</td><td>Above {money(p.appetite.maxRevenueRefer)}</td></tr>}
              {p.appetite.maxRevenueDecline && <tr><td>Revenue</td><td>Decline</td><td>Above {money(p.appetite.maxRevenueDecline)}</td></tr>}
              {p.appetite.minYearsInBusiness && <tr><td>Years in business</td><td>Refer</td><td>Fewer than {p.appetite.minYearsInBusiness}</td></tr>}
            </tbody>
          </table>
        </Panel>
      ))}
      {tab === 'rating' && (
        <>
          <Panel title="General Liability Classes">
            <table className="list">
              <thead><tr><th>Code</th><th>Description</th><th>Basis</th><th className="r">Prem/Ops Rate</th><th className="r">Products Rate</th><th>Hazard</th></tr></thead>
              <tbody>{ref.gl.classes.map((c) => <tr key={c.code}><td>{c.code}</td><td>{c.description}</td><td>{c.basis}</td><td className="r">{c.premOpsRate}</td><td className="r">{c.productsRate}</td><td>{c.hazard}</td></tr>)}</tbody>
            </table>
          </Panel>
          <div className="grid-2">
            <Panel title="Property Construction Classes">
              <table className="list">
                <thead><tr><th>Class</th><th>Name</th></tr></thead>
                <tbody>{Object.entries(ref.property.constructionClasses).map(([k, c]) => <tr key={k}><td>{k}</td><td>{c.name}</td></tr>)}</tbody>
              </table>
            </Panel>
            <Panel title="Property Occupancy Factors">
              <table className="list">
                <thead><tr><th>Occupancy</th><th className="r">Factor</th><th>Hazard</th></tr></thead>
                <tbody>{Object.entries(ref.property.occupancies).map(([k, o]) => <tr key={k}><td>{k}</td><td className="r">{o.factor}</td><td>{o.hazard}</td></tr>)}</tbody>
              </table>
            </Panel>
          </div>
          <Panel title="Cyber Industry Hazard Factors">
            <table className="list">
              <thead><tr><th>NAICS</th><th>Description</th><th className="r">Factor</th></tr></thead>
              <tbody>{(ref.industries as { naics: string; description: string; cyberFactor?: number }[]).map((i) => <tr key={i.naics}><td>{i.naics}</td><td>{i.description}</td><td className="r">{i.cyberFactor}</td></tr>)}</tbody>
            </table>
          </Panel>
        </>
      )}
      {tab === 'sanctions' && (
        <Panel title="Restricted Party List (simulated)">
          <table className="list">
            <thead><tr><th>Name</th><th>Program</th><th>Country</th></tr></thead>
            <tbody>{ref.sanctionsList.map((s) => <tr key={s.name}><td>{s.name}</td><td>{s.program}</td><td>{s.country}</td></tr>)}</tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}

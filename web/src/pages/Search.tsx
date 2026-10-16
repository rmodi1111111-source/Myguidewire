import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, fmtDate, money, policyBadge, type Account, type PolicyRow, type SubmissionRow } from '../api';
import SubmissionTable from '../components/SubmissionTable';
import { Button, Empty, FieldRow, PageTitle, Panel, Select, StatusBadge, Tabs, TextInput, Toolbar } from '../components/ui';
import { useApp } from '../context';

export default function Search() {
  const { ref, producers, users } = useApp();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<'submissions' | 'policies' | 'accounts'>(params.get('tab') === 'policies' ? 'policies' : 'submissions');
  const [policies, setPolicies] = useState<PolicyRow[] | null>(null);
  const [policyStatus, setPolicyStatus] = useState('');
  const [q, setQ] = useState(params.get('q') ?? '');
  const [status, setStatus] = useState('');
  const [product, setProduct] = useState('');
  const [producerId, setProducerId] = useState<number | ''>('');
  const [underwriterId, setUnderwriterId] = useState<number | ''>('');
  const [subs, setSubs] = useState<SubmissionRow[] | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);

  const search = async (e?: FormEvent) => {
    e?.preventDefault();
    if (tab === 'submissions') {
      const p = new URLSearchParams();
      if (q) p.set('q', q);
      if (status) p.set('status', status);
      if (product) p.set('product', product);
      if (producerId) p.set('producerId', String(producerId));
      if (underwriterId) p.set('underwriterId', String(underwriterId));
      setSubs(await api(`/submissions?${p}`));
    } else if (tab === 'policies') {
      setPolicies(await api(`/policies?q=${encodeURIComponent(q)}${policyStatus ? `&status=${encodeURIComponent(policyStatus)}` : ''}`));
    } else {
      setAccounts(await api(`/accounts?q=${encodeURIComponent(q)}`));
    }
  };
  useEffect(() => {
    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const statuses = ['INTAKE', 'CLEARANCE_REFERRAL', 'DRAFT', 'RATED', 'QUOTED', 'DECLINED', 'WITHDRAWN'];
  return (
    <div className="content-pad">
      <PageTitle>Search</PageTitle>
      <Tabs tabs={[{ key: 'submissions', label: 'Submissions & Transactions' }, { key: 'policies', label: 'Policies' }, { key: 'accounts', label: 'Accounts' }]} active={tab} onChange={setTab} />
      <Panel>
        <form onSubmit={search} className="search-form">
          <div className="grid-2">
            <FieldRow label={tab === 'submissions' ? 'Account name / Job #' : tab === 'policies' ? 'Policy # / Account name' : 'Name / Account # / FEIN / City'}>
              <TextInput value={q} onChange={setQ} />
            </FieldRow>
            {tab === 'policies' && (
              <FieldRow label="Status"><Select value={policyStatus} onChange={setPolicyStatus} placeholder="<any>" options={['In Force', 'Scheduled', 'Bound - Pending Issuance', 'Pending Cancellation', 'Canceled', 'Expired']} /></FieldRow>
            )}
            {tab === 'submissions' && (
              <>
                <FieldRow label="Status"><Select value={status} onChange={setStatus} placeholder="<any>" options={statuses.map((s) => ({ value: s, label: s.replace('_', ' ') }))} /></FieldRow>
                <FieldRow label="Product"><Select value={product} onChange={setProduct} placeholder="<any>" options={Object.values(ref.products).map((p) => ({ value: p.code, label: p.name }))} /></FieldRow>
                <FieldRow label="Producer"><Select value={producerId} onChange={setProducerId} placeholder="<any>" options={producers.map((p) => ({ value: p.id, label: p.name }))} /></FieldRow>
                <FieldRow label="Underwriter"><Select value={underwriterId} onChange={setUnderwriterId} placeholder="<any>" options={users.filter((u) => u.authorityLevel > 0).map((u) => ({ value: u.id, label: u.name }))} /></FieldRow>
              </>
            )}
          </div>
          <Toolbar>
            <Button primary type="submit">Search</Button>
            <Button onClick={() => { setQ(''); setStatus(''); setProduct(''); setProducerId(''); setUnderwriterId(''); }}>Reset</Button>
          </Toolbar>
        </form>
      </Panel>
      <Panel title="Search Results">
        {tab === 'submissions' && (subs ? <SubmissionTable rows={subs} /> : <Empty>Loading...</Empty>)}
        {tab === 'policies' && (policies ? (
          !policies.length ? <Empty>No policies found.</Empty> : <PolicyTable rows={policies} />
        ) : <Empty>Loading...</Empty>)}
        {tab === 'accounts' && (accounts ? (
          !accounts.length ? <Empty>No accounts found.</Empty> : (
            <table className="list">
              <thead><tr><th>Account #</th><th>Name</th><th>FEIN</th><th>Industry</th><th>City / State</th><th className="r">Revenue</th></tr></thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td><Link to={`/accounts/${a.id}`}>{a.accountNumber}</Link></td>
                    <td>{a.name}</td><td>{a.fein}</td><td>{a.industry}</td><td>{a.city}, {a.state}</td><td className="r">{money(a.annualRevenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : <Empty>Loading...</Empty>)}
      </Panel>
    </div>
  );
}

export function PolicyTable({ rows }: { rows: PolicyRow[] }) {
  return (
    <table className="list">
      <thead><tr><th>Policy #</th><th>Account</th><th>Product</th><th>Status</th><th>Term</th><th>Producer</th><th className="r">Term Premium</th></tr></thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.id}>
            <td><Link to={`/policies/${p.id}`}>{p.policyNumber}</Link></td>
            <td><Link to={`/accounts/${p.accountId}`}>{p.accountName}</Link></td>
            <td>{p.productName}</td>
            <td><StatusBadge status={policyBadge(p.status)} label={p.status} /></td>
            <td>{fmtDate(p.periodStart)} - {fmtDate(p.periodEnd)}</td>
            <td>{p.producerName}</td>
            <td className="r">{money(p.termPremium)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

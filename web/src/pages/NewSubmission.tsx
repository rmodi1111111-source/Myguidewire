import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, money, type Account, type Product, type Submission } from '../api';
import AccountForm, { emptyAccount } from '../components/AccountForm';
import { Button, Empty, FieldRow, Messages, PageTitle, Panel, Select, StatusBadge, TextInput, Toolbar } from '../components/ui';
import { useApp } from '../context';

type Step = 'account' | 'details' | 'done';

export default function NewSubmission() {
  const { ref, producers } = useApp();
  const [params] = useSearchParams();
  const [step, setStep] = useState<Step>('account');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Account[] | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [newAccount, setNewAccount] = useState<Partial<Account> | null>(null);
  const [matches, setMatches] = useState<{ account: Account; score: number }[]>([]);
  const [error, setError] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [details, setDetails] = useState({
    producerId: 0, effectiveDate: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10), receivedDate: today,
    source: 'Broker Email', priority: 'Normal' as Submission['priority'], description: '', products: [] as Product[],
  });
  const [files, setFiles] = useState<FileList | null>(null);
  const [created, setCreated] = useState<Submission[]>([]);

  useEffect(() => {
    const accountId = params.get('accountId');
    if (accountId) api<{ account: Account }>(`/accounts/${accountId}`).then((d) => { setAccount(d.account); setStep('details'); });
  }, [params]);

  const search = async () => setResults(await api<Account[]>(`/accounts?q=${encodeURIComponent(q)}`));

  // Account matching (duplicate prevention) as the user types a new account.
  useEffect(() => {
    if (!newAccount?.name || newAccount.name.length < 3) return setMatches([]);
    const t = setTimeout(() => api<{ account: Account; score: number }[]>('/accounts/match', { body: { name: newAccount.name, fein: newAccount.fein } }).then(setMatches), 300);
    return () => clearTimeout(t);
  }, [newAccount?.name, newAccount?.fein]);

  const toggleProduct = (p: Product) =>
    setDetails((d) => ({ ...d, products: d.products.includes(p) ? d.products.filter((x) => x !== p) : [...d.products, p] }));

  const createAll = async () => {
    const errs: string[] = [];
    if (!details.producerId) errs.push('Producer is required.');
    if (!details.products.length) errs.push('Select at least one product.');
    if (!details.effectiveDate) errs.push('Effective date is required.');
    if (newAccount && !newAccount.name) errs.push('Account name is required.');
    if (errs.length) return setError(errs);
    setBusy(true);
    setError([]);
    try {
      const res = await api<{ submissions: Submission[] }>('/submissions', {
        body: { ...details, accountId: account?.id, newAccount: account ? undefined : newAccount },
      });
      if (files?.length) {
        for (const s of res.submissions) {
          for (const f of Array.from(files)) {
            const fd = new FormData();
            fd.append('file', f);
            fd.append('docType', 'Broker Submission');
            await api(`/submissions/${s.id}/documents`, { form: fd });
          }
        }
      }
      setCreated(res.submissions);
      setStep('done');
    } catch (e: any) {
      setError([e.message]);
    } finally {
      setBusy(false);
    }
  };

  const steps: [Step, string][] = [['account', '1. Account'], ['details', '2. Submission Details'], ['done', '3. Clearance Results']];

  return (
    <div className="content-pad">
      <PageTitle sub="Submission intake: identify the account, capture broker details, and run automated clearance.">New Submission</PageTitle>
      <div className="stepper">
        {steps.map(([k, l]) => <span key={k} className={`step${step === k ? ' active' : ''}`}>{l}</span>)}
      </div>
      <Messages errors={error} />

      {step === 'account' && (
        <>
          <Panel title="Search for an existing account">
            <Toolbar>
              <TextInput value={q} onChange={setQ} placeholder="Name, account #, FEIN or city" />
              <Button primary onClick={search}>Search</Button>
              <Button onClick={() => { setNewAccount({ ...emptyAccount }); setAccount(null); setResults(null); }}>Create New Account</Button>
            </Toolbar>
            {results && (!results.length ? <Empty>No matching accounts. Create a new account.</Empty> : (
              <table className="list">
                <thead><tr><th /><th>Account #</th><th>Name</th><th>FEIN</th><th>Address</th><th className="r">Revenue</th></tr></thead>
                <tbody>
                  {results.map((a) => (
                    <tr key={a.id}>
                      <td><Button onClick={() => { setAccount(a); setNewAccount(null); setStep('details'); }}>Select</Button></td>
                      <td>{a.accountNumber}</td><td>{a.name}</td><td>{a.fein}</td><td>{a.address1}, {a.city}, {a.state}</td><td className="r">{money(a.annualRevenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
          </Panel>
          {newAccount && (
            <Panel title="Create New Account">
              {matches.length > 0 && (
                <div className="msg msg-warning">
                  Possible existing account(s) - select one instead of creating a duplicate:
                  <ul>
                    {matches.map((m) => (
                      <li key={m.account.id}>
                        <a href="#" onClick={(e) => { e.preventDefault(); setAccount(m.account); setNewAccount(null); setStep('details'); }}>
                          {m.account.accountNumber} {m.account.name} ({m.account.city}, {m.account.state})
                        </a> - {(m.score * 100).toFixed(0)}% match
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <AccountForm value={newAccount} onChange={setNewAccount} />
              <Toolbar>
                <Button primary onClick={() => { if (!newAccount.name) return setError(['Account name is required.']); setError([]); setStep('details'); }}>Next &gt;</Button>
              </Toolbar>
            </Panel>
          )}
        </>
      )}

      {step === 'details' && (
        <>
          <div className="info-bar">
            <span><b>Account</b> {account ? `${account.accountNumber} ${account.name}` : `${newAccount?.name} (new)`}</span>
            <span><b>Address</b> {(account ?? newAccount)?.city}, {(account ?? newAccount)?.state}</span>
          </div>
          <Panel title="Producer & Dates">
            <div className="grid-2">
              <div>
                <FieldRow label="Producer of Record" required>
                  <Select value={details.producerId || ''} placeholder="<select>" onChange={(v) => setDetails({ ...details, producerId: v as number })}
                    options={producers.filter((p) => p.active).map((p) => ({ value: p.id, label: `${p.code} - ${p.name}` }))} />
                </FieldRow>
                <FieldRow label="Effective Date" required><TextInput type="date" value={details.effectiveDate} onChange={(v) => setDetails({ ...details, effectiveDate: v })} /></FieldRow>
                <FieldRow label="Received Date"><TextInput type="date" value={details.receivedDate} onChange={(v) => setDetails({ ...details, receivedDate: v })} /></FieldRow>
              </div>
              <div>
                <FieldRow label="Source"><Select value={details.source} onChange={(v) => setDetails({ ...details, source: v })} options={ref.sources} /></FieldRow>
                <FieldRow label="Priority"><Select value={details.priority} onChange={(v) => setDetails({ ...details, priority: v })} options={['Low', 'Normal', 'High', 'Rush'] as Submission['priority'][]} /></FieldRow>
                <FieldRow label="Broker Documents" hint="ACORD forms, applications, loss runs, SOVs">
                  <input type="file" multiple onChange={(e) => setFiles(e.target.files)} />
                </FieldRow>
              </div>
            </div>
            <FieldRow label="Broker Notes">
              <textarea className="input textarea" value={details.description} onChange={(e) => setDetails({ ...details, description: e.target.value })} />
            </FieldRow>
          </Panel>
          <Panel title="Products - select one or more">
            <table className="list">
              <thead><tr><th style={{ width: 40 }} /><th>Product</th><th>Description</th></tr></thead>
              <tbody>
                {Object.values(ref.products).map((p) => (
                  <tr key={p.code} onClick={() => toggleProduct(p.code as Product)} className="clickable">
                    <td><input type="checkbox" checked={details.products.includes(p.code as Product)} readOnly /></td>
                    <td>{p.name}</td>
                    <td>{p.code === 'CYBER' ? 'Network security, privacy liability, breach response, ransomware, BI' : p.code === 'PROPERTY' ? 'Buildings, contents, business income; CAT perils' : 'Premises/operations and products/completed operations liability'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <Toolbar>
            <Button onClick={() => setStep('account')}>&lt; Back</Button>
            <Button primary onClick={createAll} disabled={busy}>{busy ? 'Creating...' : 'Create Submission(s) & Run Clearance'}</Button>
          </Toolbar>
        </>
      )}

      {step === 'done' && (
        <Panel title="Submissions created">
          <table className="list">
            <thead><tr><th>Submission #</th><th>Product</th><th>Clearance</th><th>Status</th><th>Next step</th></tr></thead>
            <tbody>
              {created.map((s) => (
                <tr key={s.id}>
                  <td><Link to={`/submissions/${s.id}`}>{s.jobNumber}</Link></td>
                  <td>{ref.products[s.product].name}</td>
                  <td><StatusBadge status={s.clearance?.outcome ?? 'n/a'} /></td>
                  <td><StatusBadge status={s.status} label={s.status.replace('_', ' ')} /></td>
                  <td>
                    {s.status === 'DRAFT' && <Link to={`/submissions/${s.id}/policy-info`}>Proceed to risk entry</Link>}
                    {s.status === 'CLEARANCE_REFERRAL' && <Link to={`/submissions/${s.id}/clearance`}>Review clearance referral</Link>}
                    {s.status === 'DECLINED' && <Link to={`/submissions/${s.id}/clearance`}>View decline reason</Link>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}

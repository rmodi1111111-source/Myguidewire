import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, fmtDateTime, type Account, type PolicyRow, type SubmissionRow } from '../api';
import { PolicyTable } from './Search';
import AccountForm from '../components/AccountForm';
import SubmissionTable from '../components/SubmissionTable';
import { Button, Messages, PageTitle, Panel, Toolbar } from '../components/ui';
import { pushRecent } from '../recent';

interface AccountData {
  account: Account;
  submissions: SubmissionRow[];
  policies: PolicyRow[];
  history: { id: number; event: string; detail: string; user_name: string; created_at: string }[];
}

export default function AccountPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState<AccountData | null>(null);
  const [edit, setEdit] = useState<Partial<Account> | null>(null);
  const [error, setError] = useState('');

  const load = () =>
    api<AccountData>(`/accounts/${id}`).then((d) => {
      setData(d);
      pushRecent('accounts', { id: d.account.id, label: `${d.account.accountNumber} ${d.account.name}` });
    }).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const save = async () => {
    try {
      await api(`/accounts/${id}`, { method: 'PUT', body: edit });
      setEdit(null);
      setError('');
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (!data) return <div className="content-pad"><Messages errors={error ? [error] : []} /></div>;
  const a = data.account;
  return (
    <div className="content-pad">
      <div className="info-bar">
        <span><b>Account</b> {a.accountNumber}</span>
        <span><b>Name</b> {a.name}</span>
        <span><b>Industry</b> {a.industry || '-'}</span>
        <span><b>State</b> {a.state}</span>
      </div>
      <PageTitle>Account File Summary</PageTitle>
      <Toolbar>
        {edit ? (
          <>
            <Button primary onClick={save}>Update</Button>
            <Button onClick={() => setEdit(null)}>Cancel</Button>
          </>
        ) : (
          <>
            <Button onClick={() => setEdit(a)}>Edit Account</Button>
            <Button primary onClick={() => nav(`/new-submission?accountId=${a.id}`)}>New Submission</Button>
          </>
        )}
      </Toolbar>
      <Messages errors={error ? [error] : []} />
      <Panel title="Account Information">
        <AccountForm value={edit ?? a} onChange={setEdit} readOnly={!edit} />
      </Panel>
      <Panel title={`Policies (${data.policies.length})`}>
        {data.policies.length ? <PolicyTable rows={data.policies} /> : <div className="muted">No policies yet.</div>}
      </Panel>
      <Panel title={`Submissions & Transactions (${data.submissions.length})`}>
        <SubmissionTable rows={data.submissions} showAccount={false} />
      </Panel>
      <Panel title="Account History">
        <table className="list">
          <thead><tr><th>Date</th><th>Event</th><th>Detail</th><th>User</th></tr></thead>
          <tbody>
            {data.history.map((h) => (
              <tr key={h.id}><td>{fmtDateTime(h.created_at)}</td><td>{h.event}</td><td>{h.detail}</td><td>{h.user_name}</td></tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

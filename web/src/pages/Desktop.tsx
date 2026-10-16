import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, fmtDate, money, type SubmissionRow } from '../api';
import SubmissionTable from '../components/SubmissionTable';
import { Button, Empty, PageTitle, Panel, Toolbar } from '../components/ui';
import { useApp } from '../context';

interface DesktopData {
  counts: Record<string, number>;
  mySubmissions: SubmissionRow[];
  clearanceQueue: SubmissionRow[];
  myActivities: { id: number; subject: string; description: string; priority: string; due_date: string; submission_id: number; jobNumber: string; accountName: string }[];
  recentQuotes: { id: number; quoteNumber: string; premium: number; validUntil: string; submissionId: number; jobNumber: string; product: string; accountName: string }[];
}

type View = 'summary' | 'activities' | 'submissions' | 'queue' | 'quotes';

export default function Desktop() {
  const { user, ref } = useApp();
  const nav = useNavigate();
  const [data, setData] = useState<DesktopData | null>(null);
  const [view, setView] = useState<View>('summary');
  const load = () => api<DesktopData>('/desktop').then(setData);
  useEffect(() => {
    load();
  }, []);

  const complete = async (id: number) => {
    await api(`/activities/${id}/complete`, { method: 'POST' });
    load();
  };

  const views: { key: View; label: string; count?: number }[] = [
    { key: 'summary', label: 'My Summary' },
    { key: 'activities', label: 'My Activities', count: data?.myActivities.length },
    { key: 'submissions', label: 'My Submissions', count: data?.mySubmissions.length },
    { key: 'queue', label: 'Clearance Queue', count: data?.clearanceQueue.length },
    { key: 'quotes', label: 'Active Quotes', count: data?.recentQuotes.length },
  ];

  const pipeline: [string, string][] = [
    ['INTAKE', 'Intake'], ['CLEARANCE_REFERRAL', 'Clearance Referral'], ['DRAFT', 'Draft'], ['RATED', 'Rated'], ['QUOTED', 'Quoted'], ['DECLINED', 'Declined'], ['WITHDRAWN', 'Withdrawn'],
  ];

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-actions">
          <Button primary onClick={() => nav('/new-submission')}>New Submission</Button>
        </div>
        <ul className="side-nav">
          {views.map((v) => (
            <li key={v.key} className={view === v.key ? 'active' : ''} onClick={() => setView(v.key)}>
              {v.label} {v.count !== undefined && <span className="count">{v.count}</span>}
            </li>
          ))}
        </ul>
      </aside>
      <div className="content">
        <PageTitle sub={`${user.role} - authority level ${user.authorityLevel}`}>Desktop: {views.find((v) => v.key === view)?.label}</PageTitle>
        {!data ? <Empty>Loading...</Empty> : (
          <>
            {view === 'summary' && (
              <>
                <div className="kpis">
                  {pipeline.map(([k, label]) => (
                    <div key={k} className={`kpi kpi-${k.toLowerCase()}`}>
                      <div className="kpi-value">{data.counts[k] ?? 0}</div>
                      <div className="kpi-label">{label}</div>
                    </div>
                  ))}
                </div>
                <Panel title="Open activities">
                  <ActivityTable rows={data.myActivities.slice(0, 5)} onComplete={complete} />
                </Panel>
                <Panel title="My submissions in progress">
                  <SubmissionTable rows={data.mySubmissions.slice(0, 8)} />
                </Panel>
              </>
            )}
            {view === 'activities' && <Panel><ActivityTable rows={data.myActivities} onComplete={complete} /></Panel>}
            {view === 'submissions' && <Panel><SubmissionTable rows={data.mySubmissions} /></Panel>}
            {view === 'queue' && (
              <Panel title="Submissions awaiting clearance decision">
                <SubmissionTable rows={data.clearanceQueue} />
              </Panel>
            )}
            {view === 'quotes' && (
              <Panel>
                {!data.recentQuotes.length ? <Empty>No active quotes.</Empty> : (
                  <table className="list">
                    <thead><tr><th>Quote #</th><th>Submission</th><th>Account</th><th>Product</th><th className="r">Premium</th><th>Valid Until</th><th /></tr></thead>
                    <tbody>
                      {data.recentQuotes.map((q) => (
                        <tr key={q.id}>
                          <td>{q.quoteNumber}</td>
                          <td><Link to={`/submissions/${q.submissionId}/quote`}>{q.jobNumber}</Link></td>
                          <td>{q.accountName}</td>
                          <td>{ref.products[q.product]?.name}</td>
                          <td className="r">{money(q.premium)}</td>
                          <td>{fmtDate(q.validUntil)}</td>
                          <td><a href={`/api/quotes/${q.id}/pdf`} target="_blank" rel="noreferrer">View PDF</a></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Panel>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ActivityTable({ rows, onComplete }: { rows: DesktopData['myActivities']; onComplete: (id: number) => void }) {
  if (!rows.length) return <Empty>No open activities.</Empty>;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <table className="list">
      <thead><tr><th>Due</th><th>Priority</th><th>Subject</th><th>Submission</th><th>Account</th><th /></tr></thead>
      <tbody>
        {rows.map((a) => (
          <tr key={a.id} className={a.due_date && a.due_date < today ? 'overdue' : ''}>
            <td>{fmtDate(a.due_date)}</td>
            <td>{a.priority}</td>
            <td title={a.description}>{a.subject}</td>
            <td>{a.submission_id ? <Link to={`/submissions/${a.submission_id}`}>{a.jobNumber}</Link> : '-'}</td>
            <td>{a.accountName ?? '-'}</td>
            <td><Toolbar><Button onClick={() => onComplete(a.id)}>Complete</Button></Toolbar></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

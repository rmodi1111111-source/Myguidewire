import { useState } from 'react';
import { Link } from 'react-router-dom';
import { STANDALONE, api, fmtDate, fmtDateTime, type SubmissionDetail } from '../../api';
import { Button, Empty, FieldRow, Panel, Select, TextInput, Toolbar } from '../../components/ui';
import { useApp } from '../../context';
import type { StepProps } from '../SubmissionPage';

export function Documents({ detail, setDetail }: StepProps) {
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState('Broker Submission');
  const [error, setError] = useState('');
  const upload = async () => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('docType', docType);
    try {
      setDetail(await api<SubmissionDetail>(`/submissions/${detail.submission.id}/documents`, { form: fd }));
      setFile(null);
      setError('');
    } catch (e: any) {
      setError(e.message);
    }
  };
  return (
    <>
      <Panel title="Upload Document">
        <Toolbar>
          <Select value={docType} onChange={setDocType} options={['Broker Submission', 'ACORD Application', 'Supplemental Application', 'Loss Runs', 'Statement of Values', 'Financials', 'Inspection Report', 'Correspondence']} />
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <Button primary disabled={!file} onClick={upload}>Upload</Button>
          {error && <span className="err">{error}</span>}
        </Toolbar>
      </Panel>
      <Panel title="Documents">
        {!detail.documents.length ? <Empty>No documents.</Empty> : (
          <table className="list">
            <thead><tr><th>Name</th><th>Type</th><th>Size</th><th>By</th><th>Date</th></tr></thead>
            <tbody>
              {detail.documents.map((d) => (
                <tr key={d.id}>
                  <td>
                    {d.quoteId ? <Link to={`/quotes/${d.quoteId}`}>{d.name.replace(/\.pdf$/, '')}</Link>
                      : STANDALONE ? <span title="Stored in this browser">{d.name}</span>
                      : <a href={`/api/documents/${d.id}/download`} target="_blank" rel="noreferrer">{d.name}</a>}
                  </td>
                  <td>{d.docType}</td>
                  <td>{d.size ? `${Math.ceil(d.size / 1024)} KB` : '-'}</td>
                  <td>{d.uploadedBy}</td>
                  <td>{fmtDateTime(d.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}

export function Notes({ detail, setDetail }: StepProps) {
  const [topic, setTopic] = useState('Underwriting');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const add = async () => {
    setDetail(await api<SubmissionDetail>(`/submissions/${detail.submission.id}/notes`, { body: { topic, subject, body } }));
    setSubject('');
    setBody('');
  };
  return (
    <>
      <Panel title="New Note">
        <FieldRow label="Topic"><Select value={topic} onChange={setTopic} options={['Underwriting', 'Clearance', 'Pricing', 'Broker Communication', 'General']} /></FieldRow>
        <FieldRow label="Subject"><TextInput value={subject} onChange={setSubject} /></FieldRow>
        <FieldRow label="Text" required><textarea className="input textarea" value={body} onChange={(e) => setBody(e.target.value)} /></FieldRow>
        <Toolbar><Button primary disabled={!body.trim()} onClick={add}>Add Note</Button></Toolbar>
      </Panel>
      <Panel title="Notes">
        {!detail.notes.length ? <Empty>No notes.</Empty> : detail.notes.map((n) => (
          <div key={n.id} className="note">
            <div className="note-head"><b>{n.subject || n.topic}</b> <span className="muted">{n.topic} - {n.author} - {fmtDateTime(n.created_at)}</span></div>
            <div className="note-body">{n.body}</div>
          </div>
        ))}
      </Panel>
    </>
  );
}

export function Activities({ detail, setDetail }: StepProps) {
  const { users, user } = useApp();
  const [form, setForm] = useState({ subject: '', description: '', assignedTo: user.id, priority: 'Normal', dueDate: '' });
  const refresh = async () => setDetail(await api<SubmissionDetail>(`/submissions/${detail.submission.id}`));
  return (
    <>
      <Panel title="New Activity">
        <div className="grid-2">
          <div>
            <FieldRow label="Subject" required><TextInput value={form.subject} onChange={(v) => setForm({ ...form, subject: v })} /></FieldRow>
            <FieldRow label="Assign To"><Select value={form.assignedTo} onChange={(v) => setForm({ ...form, assignedTo: v })} options={users.map((u) => ({ value: u.id, label: u.name }))} /></FieldRow>
          </div>
          <div>
            <FieldRow label="Priority"><Select value={form.priority} onChange={(v) => setForm({ ...form, priority: v })} options={['Low', 'Normal', 'High', 'Urgent']} /></FieldRow>
            <FieldRow label="Due Date"><TextInput type="date" value={form.dueDate} onChange={(v) => setForm({ ...form, dueDate: v })} /></FieldRow>
          </div>
        </div>
        <FieldRow label="Description"><textarea className="input textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></FieldRow>
        <Toolbar>
          <Button primary disabled={!form.subject.trim()} onClick={async () => { setDetail(await api<SubmissionDetail>(`/submissions/${detail.submission.id}/activities`, { body: form })); setForm({ ...form, subject: '', description: '' }); }}>Create Activity</Button>
        </Toolbar>
      </Panel>
      <Panel title="Activities">
        {!detail.activities.length ? <Empty>No activities.</Empty> : (
          <table className="list">
            <thead><tr><th>Due</th><th>Subject</th><th>Assigned To</th><th>Priority</th><th>Status</th><th /></tr></thead>
            <tbody>
              {detail.activities.map((a) => (
                <tr key={a.id}>
                  <td>{fmtDate(a.due_date)}</td>
                  <td title={a.description}>{a.subject}</td>
                  <td>{a.assigned_name ?? '-'}</td>
                  <td>{a.priority}</td>
                  <td>{a.status}</td>
                  <td>{a.status === 'Open' && <Button onClick={async () => { await api(`/activities/${a.id}/complete`, { body: {} }); refresh(); }}>Complete</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}

export function History({ detail }: StepProps) {
  return (
    <Panel title="History">
      <table className="list">
        <thead><tr><th style={{ width: 160 }}>Date</th><th style={{ width: 200 }}>Event</th><th>Detail</th><th style={{ width: 140 }}>User</th></tr></thead>
        <tbody>
          {detail.history.map((h) => <tr key={h.id}><td>{fmtDateTime(h.created_at)}</td><td>{h.event}</td><td>{h.detail}</td><td>{h.user_name}</td></tr>)}
        </tbody>
      </table>
    </Panel>
  );
}

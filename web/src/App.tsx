import { useState, type FormEvent } from 'react';
import { NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { api, type SubmissionRow } from './api';
import { useApp } from './context';
import Desktop from './pages/Desktop';
import Search from './pages/Search';
import AccountPage from './pages/AccountPage';
import NewSubmission from './pages/NewSubmission';
import SubmissionPage from './pages/SubmissionPage';
import Admin from './pages/Admin';
import QuoteProposal from './pages/QuoteProposal';
import { getRecent } from './recent';

function Header() {
  const { user, users, switchUser } = useApp();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const go = async (e: FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    const rows = await api<SubmissionRow[]>(`/submissions?q=${encodeURIComponent(q.trim())}`);
    setQ('');
    if (rows.length === 1) nav(`/submissions/${rows[0].id}`);
    else nav(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  const menu = (key: string, label: string, items: { label: string; to: string }[]) => (
    <div className="tab-menu" onPointerEnter={(e) => e.pointerType === 'mouse' && setOpen(key)} onPointerLeave={(e) => e.pointerType === 'mouse' && setOpen(null)}>
      <span className="tab" onClick={() => setOpen(open === key ? null : key)}>{label} <span className="caret">&#9662;</span></span>
      {open === key && (
        <div className="dropdown">
          {items.map((i) => (
            <button key={i.to + i.label} className="dropdown-item" onClick={() => { setOpen(null); nav(i.to); }}>
              {i.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const recent = getRecent();
  return (
    <header className="app-header">
      <div className="brand" onClick={() => nav('/')}>
        <span className="brand-mark">PB</span>
        <span className="brand-name">PreBind Center</span>
      </div>
      <nav className="tabs">
        <NavLink to="/" end className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>Desktop</NavLink>
        {menu('account', 'Account', [
          { label: 'New Account / Submission...', to: '/new-submission' },
          ...recent.accounts.map((a) => ({ label: a.label, to: `/accounts/${a.id}` })),
        ])}
        {menu('submission', 'Submission', [
          { label: 'New Submission...', to: '/new-submission' },
          ...recent.submissions.map((s) => ({ label: s.label, to: `/submissions/${s.id}` })),
        ])}
        <NavLink to="/search" className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>Search</NavLink>
        <NavLink to="/admin" className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>Administration</NavLink>
      </nav>
      <form className="goto" onSubmit={go}>
        <input placeholder="Go to job # / account..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Go to" />
      </form>
      <div className="user-switch">
        <select value={user.id} onChange={(e) => switchUser(Number(e.target.value))} aria-label="Current user">
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.name} - {u.role} (L{u.authorityLevel})</option>
          ))}
        </select>
      </div>
    </header>
  );
}

export default function App() {
  const { user } = useApp();
  return (
    <div className="app">
      <Header />
      {/* key forces a reload of page data when switching user */}
      <main className="app-main" key={user.id}>
        <Routes>
          <Route path="/" element={<Desktop />} />
          <Route path="/search" element={<Search />} />
          <Route path="/accounts/:id" element={<AccountPage />} />
          <Route path="/new-submission" element={<NewSubmission />} />
          <Route path="/submissions/:id/*" element={<SubmissionPage />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/quotes/:id" element={<QuoteProposal />} />
          <Route path="*" element={<div className="content-pad">Page not found.</div>} />
        </Routes>
      </main>
    </div>
  );
}

import { Link } from 'react-router-dom';
import { fmtDate, money, type SubmissionRow } from '../api';
import { Empty, StatusBadge } from './ui';

export default function SubmissionTable({ rows, showAccount = true }: { rows: SubmissionRow[]; showAccount?: boolean }) {
  if (!rows.length) return <Empty>No submissions.</Empty>;
  return (
    <table className="list">
      <thead>
        <tr>
          <th>Transaction #</th>
          <th>Type</th>
          {showAccount && <th>Account</th>}
          <th>Product</th>
          <th>Status</th>
          <th>Effective</th>
          <th>Producer</th>
          <th>Underwriter</th>
          <th>Priority</th>
          <th className="r">Premium</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td><Link to={`/submissions/${r.id}`}>{r.jobNumber}</Link></td>
            <td>{r.jobTypeLabel ?? 'Submission'}</td>
            {showAccount && <td><Link to={`/accounts/${r.accountId}`}>{r.accountName}</Link></td>}
            <td>{r.productName}</td>
            <td><StatusBadge status={r.status} label={r.statusLabel} /></td>
            <td>{fmtDate(r.effectiveDate)}</td>
            <td>{r.producerName}</td>
            <td>{r.underwriterName ?? <em>Unassigned</em>}</td>
            <td>{r.priority === 'Rush' || r.priority === 'High' ? <strong className="prio">{r.priority}</strong> : r.priority}</td>
            <td className="r">{money(r.premium)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

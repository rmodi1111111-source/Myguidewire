import { useState, type ReactNode } from 'react';

export function Panel({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <div className="panel-header">
          <h3>{title}</h3>
          <div className="panel-actions">{actions}</div>
        </div>
      )}
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="page-title">
      <h1>{children}</h1>
      {sub && <div className="page-sub">{sub}</div>}
    </div>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="toolbar">{children}</div>;
}

export function Button({ children, onClick, primary, disabled, title, type = 'button', danger }: { children: ReactNode; onClick?: () => void; primary?: boolean; disabled?: boolean; title?: string; type?: 'button' | 'submit'; danger?: boolean }) {
  return (
    <button type={type} className={`btn${primary ? ' btn-primary' : ''}${danger ? ' btn-danger' : ''}`} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

export function Messages({ errors = [], warnings = [], infos = [] }: { errors?: string[]; warnings?: string[]; infos?: string[] }) {
  if (!errors.length && !warnings.length && !infos.length) return null;
  return (
    <div className="messages">
      {errors.map((m, i) => <div key={`e${i}`} className="msg msg-error">{m}</div>)}
      {warnings.map((m, i) => <div key={`w${i}`} className="msg msg-warning">{m}</div>)}
      {infos.map((m, i) => <div key={`i${i}`} className="msg msg-info">{m}</div>)}
    </div>
  );
}

export function FieldRow({ label, required, children, hint }: { label: string; required?: boolean; children: ReactNode; hint?: string }) {
  return (
    <div className="field-row">
      <label className="field-label">
        {required && <span className="req">*</span>}
        {label}
      </label>
      <div className="field-input">
        {children}
        {hint && <div className="field-hint">{hint}</div>}
      </div>
    </div>
  );
}

export function TextInput({ value, onChange, readOnly, placeholder, type = 'text', width }: { value: string | number | undefined; onChange?: (v: string) => void; readOnly?: boolean; placeholder?: string; type?: string; width?: number }) {
  if (readOnly) return <span className="ro">{value === '' || value === undefined ? '-' : value}</span>;
  return <input className="input" style={width ? { width } : undefined} type={type} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange?.(e.target.value)} />;
}

export function NumberInput({ value, onChange, readOnly, money, width }: { value: number | undefined; onChange?: (v: number) => void; readOnly?: boolean; money?: boolean; width?: number }) {
  const [text, setText] = useState<string | null>(null);
  const display = value === undefined || value === null || Number.isNaN(value) ? '' : money ? Number(value).toLocaleString('en-US') : String(value);
  if (readOnly) return <span className="ro">{display ? `${money ? '$' : ''}${display}` : '-'}</span>;
  return (
    <span className="num-wrap">
      {money && <span className="num-prefix">$</span>}
      <input
        className="input num"
        style={width ? { width } : undefined}
        value={text ?? display}
        onFocus={() => setText(display.replace(/,/g, ''))}
        onBlur={() => setText(null)}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value.replace(/[,$\s]/g, ''));
          if (!Number.isNaN(n)) onChange?.(n);
        }}
      />
    </span>
  );
}

export function Select<T extends string | number>({ value, onChange, options, readOnly, placeholder, width }: { value: T | undefined | ''; onChange?: (v: T) => void; options: (T | { value: T; label: string })[]; readOnly?: boolean; placeholder?: string; width?: number }) {
  const opts = options.map((o) => (typeof o === 'object' ? o : { value: o, label: String(o) }));
  if (readOnly) return <span className="ro">{opts.find((o) => o.value === value)?.label ?? (value || '-')}</span>;
  const isNum = typeof opts[0]?.value === 'number';
  return (
    <select className="input" style={width ? { width } : undefined} value={value === undefined ? '' : String(value)} onChange={(e) => onChange?.((isNum ? Number(e.target.value) : e.target.value) as T)}>
      {(placeholder !== undefined || value === '' || value === undefined) && <option value="">{placeholder ?? '<none>'}</option>}
      {opts.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
      ))}
    </select>
  );
}

export function YesNo({ value, onChange, readOnly }: { value: boolean; onChange?: (v: boolean) => void; readOnly?: boolean }) {
  if (readOnly) return <span className="ro">{value ? 'Yes' : 'No'}</span>;
  return (
    <span className="radio-group">
      <label><input type="radio" checked={value} onChange={() => onChange?.(true)} /> Yes</label>
      <label><input type="radio" checked={!value} onChange={() => onChange?.(false)} /> No</label>
    </span>
  );
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <span className={`badge badge-${status.toLowerCase()}`}>{label ?? status}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Modal({ title, children, onClose, footer }: { title: string; children: ReactNode; onClose: () => void; footer?: ReactNode }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">x</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, active, onChange }: { tabs: { key: T; label: ReactNode }[]; active: T; onChange: (t: T) => void }) {
  return (
    <div className="card-tabs">
      {tabs.map((t) => (
        <button key={t.key} className={`card-tab${t.key === active ? ' active' : ''}`} onClick={() => onChange(t.key)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

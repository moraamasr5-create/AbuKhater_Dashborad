// Shared UI primitives — presentation only, no business logic.
import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, MoreVertical } from 'lucide-react';

/**
 * Status tones (consistent colour language):
 * success = available / completed, warning = waiting / attention,
 * danger = problem / critical, info = active process, neutral = inactive.
 */
export const StatusBadge = ({ tone = 'neutral', icon, children, className = '', title }) => (
  <span className={`ui-badge ui-badge--${tone} ${className}`} title={title}>
    {icon}
    <span>{children}</span>
  </span>
);

export const PageHeader = ({ title, subtitle, actions }) => (
  <header className="page-header">
    <div style={{ minWidth: 0 }}>
      <h1 className="page-title">{title}</h1>
      {subtitle && <p className="page-subtitle">{subtitle}</p>}
    </div>
    {actions && <div className="page-actions">{actions}</div>}
  </header>
);

export const SectionHeader = ({ icon, title, extra }) => (
  <div className="section-header">
    <h2 className="section-title">{icon}<span>{title}</span></h2>
    {extra}
  </div>
);

/** Accessible progressive-disclosure block built on native <details>. */
export const Disclosure = ({ title, icon, meta, defaultOpen = false, children, className = '' }) => (
  <details className={`disclosure ${className}`} open={defaultOpen || undefined}>
    <summary>
      {icon}
      <span className="disclosure-title">{title}</span>
      {meta && <span className="disclosure-meta">{meta}</span>}
      <ChevronDown size={16} className="disclosure-chevron" aria-hidden="true" />
    </summary>
    <div className="disclosure-body">{children}</div>
  </details>
);

export const EmptyState = ({ icon, title, hint, action }) => (
  <div className="glass-card empty-state" role="status">
    {icon && <div className="empty-icon">{icon}</div>}
    <h3>{title}</h3>
    {hint && <p>{hint}</p>}
    {action}
  </div>
);

/** "⋮ More" menu for rare / dangerous actions. items: [{label, icon, onClick, danger}] */
export const MoreMenu = ({ items, label = 'المزيد' }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const visible = items.filter(Boolean);
  if (visible.length === 0) return null;
  return (
    <div className="more-menu" ref={ref}>
      <button type="button" className="icon-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <MoreVertical size={18} />
      </button>
      {open && (
        <div className="more-menu-list" role="menu">
          {visible.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className={`more-menu-item ${it.danger ? 'is-danger' : ''}`}
              onClick={() => { setOpen(false); it.onClick(); }}
            >
              {it.icon}<span>{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/* ---------- Toast (concise feedback, no dependency) ---------- */
const TOAST_EVENT = 'ak-toast';
export const toast = (message, tone = 'success') => {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { message, tone, id: Date.now() + Math.random() } }));
};

export const ToastHost = () => {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const onToast = (e) => {
      const t = e.detail;
      setItems(prev => [...prev, t]);
      setTimeout(() => setItems(prev => prev.filter(x => x.id !== t.id)), 2600);
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, []);
  return (
    <div className="toast-host" aria-live="polite">
      {items.map(t => <div key={t.id} className={`toast toast--${t.tone}`}>{t.message}</div>)}
    </div>
  );
};

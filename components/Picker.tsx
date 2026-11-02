'use client';
import { useState } from 'react';

export type Option = { id: string; label: string; sub?: string };

export default function Picker({ title, options, onPick, onClose, onCustom }: {
  title: string; options: Option[]; onPick: (id: string) => void; onClose: () => void; onCustom?: (text: string) => void;
}) {
  const [q, setQ] = useState('');
  const hits = options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 60);
  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="between"><strong>{title}</strong><button className="alt small" onClick={onClose}>Close</button></div>
        <input autoFocus placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginTop: 10 }} />
        <div className="scroll">
          {hits.map((o) => (
            <div key={o.id} className="opt" onClick={() => onPick(o.id)}>
              <span>{o.label}</span><span className="muted small">{o.sub}</span>
            </div>
          ))}
          {hits.length === 0 && <p className="muted">No match.</p>}
          {onCustom && q.trim() && (
            <div className="opt" onClick={() => onCustom(q.trim())}><span>➕ Use “{q.trim()}” as a one-off item</span></div>
          )}
        </div>
      </div>
    </div>
  );
}

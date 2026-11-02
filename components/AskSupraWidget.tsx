'use client';
import { useState } from 'react';
import AskSupraChat from './AskSupraChat';

export default function AskSupraWidget({ raised = false }: { raised?: boolean }) {
  const [open, setOpen] = useState(false);
  return <div className={`ask-widget${raised ? ' ask-widget-raised' : ''}`}>
    {open && <div className="ask-widget-panel"><AskSupraChat compact /></div>}
    <button className="ask-launcher" type="button" aria-expanded={open} aria-label={open ? 'Close Ask Supra chat' : 'Open Ask Supra chat'} onClick={() => setOpen(value => !value)}>
      {open ? 'Close chat' : 'Ask Supra'}
    </button>
  </div>;
}

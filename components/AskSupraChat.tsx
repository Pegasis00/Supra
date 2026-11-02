'use client';
import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChatProviderId, useAskSupra } from './AskSupraContext';
import ChatAnswer from './ChatAnswer';

const suggestions = [
  'Sales this month',
  'Top 5 customers this year',
  'Low stock products',
  'Who bought A4 Spiral Book 300 Pgs Ruled?',
];

function Evidence({ sql, rows }: { sql: string; rows: unknown }) {
  const [open, setOpen] = useState(false);
  return <details className="ask-evidence" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><span>Source details</span><span className="evidence-hint">SQL and returned rows</span></summary>
    {open && <div className="ask-evidence-body"><span className="evidence-label">QUERY</span><pre>{sql}</pre><span className="evidence-label">RESULT</span><pre>{JSON.stringify(rows, null, 2)}</pre></div>}
  </details>;
}

export default function AskSupraChat({ compact = false }: { compact?: boolean }) {
  const { messages, busy, send, reset } = useAskSupra();
  const [input, setInput] = useState('');
  const [model, setModel] = useState<string | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const providerReady = model !== null;

  useEffect(() => {
    let active = true;
    fetch('/api/rag/chat').then(response => response.json()).then(result => {
      if (!active) return;
      const available = Array.isArray(result.providers) ? result.providers as { id: ChatProviderId; name: string; model: string }[] : [];
      setModel(available[0]?.model ?? null);
    }).catch(() => { if (active) setModel(null); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (distanceToBottom < 140) element.scrollTop = element.scrollHeight;
  }, [messages, busy]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const question = input.trim();
    if (!question || busy || !providerReady) return;
    setInput('');
    void send(question);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return <section className={`ask-chat ${compact ? 'ask-chat-compact' : ''}`}>
    <header className="ask-chat-head">
      <div className="ask-chat-heading"><span className="ask-heading-mark">S</span><div><strong>Ask Supra</strong><div className="muted small">Answers grounded in your business records</div></div></div>
      <div className="ask-chat-controls">
        {!compact && <button type="button" className="alt small ask-new-chat" disabled={busy} onClick={reset}>New chat <span aria-hidden="true">↻</span></button>}
      </div>
    </header>

    {!providerReady && <div className="ask-provider-note">Configure OPENROUTER_API_KEY in .env.local and restart the app.</div>}
    <div className="ask-chat-scroll" aria-live="polite" ref={scroll}>
      {!messages.length && <div className="ask-welcome">
        <span className="ask-welcome-mark" aria-hidden="true">S</span>
        <h2>What would you like to find?</h2>
        <p className="muted small">Ask about sales, purchases, products or stock.</p>
        <div className="ask-suggestions">{suggestions.map(question => <button className="alt small" type="button" key={question} disabled={!providerReady} onClick={() => { setInput(''); void send(question); }}>{question}<span aria-hidden="true">↗</span></button>)}</div>
      </div>}
      {messages.map(message => <article className={`ask-message ${message.role} ${message.error ? 'ask-error' : ''}`} key={message.id}>
        <div className="ask-message-top"><span className={`ask-avatar ${message.role}`}>{message.role === 'user' ? 'Y' : 'S'}</span><div className="ask-message-meta"><strong>{message.role === 'user' ? 'You' : 'Supra'}</strong>{message.model && <span>{message.model}</span>}</div></div>
        <div className="ask-message-text">{message.content ? message.role === 'assistant' ? <ChatAnswer content={message.content} /> : message.content : (busy && message.role === 'assistant' ? 'Checking your records…' : '')}</div>
        {message.warning && <p className="ask-warning">{message.warning}</p>}
        {!!message.links?.length && <div className="ask-sources"><span className="evidence-label">RELATED BILLS</span>{message.links.map((bill,index)=><Link className="ask-source" key={`${bill.id}-${index}`} href={`/bills/${bill.id}`}><span className="source-document-mark" aria-hidden="true">↗</span><span><strong>Bill {bill.bill_no ?? ''}</strong><small>{bill.party_name ?? ''}{bill.bill_date ? ` · ${bill.bill_date}` : ''}</small></span><span className="source-arrow" aria-hidden="true">↗</span></Link>)}</div>}
        {!!message.tools?.length && <div className="ask-evidence-list">{message.tools.map((tool,index)=><Evidence key={`${message.id}-${index}`} sql={tool.sql} rows={tool.rows} />)}</div>}
      </article>)}
      {busy && <div className="ask-typing" role="status"><span className="typing-dots"><i /><i /><i /></span><span>Looking through your records</span></div>}
    </div>
    <form onSubmit={submit} className="ask-chat-form">
      <textarea value={input} onChange={event => setInput(event.target.value)} onKeyDown={handleKeyDown} maxLength={1000} rows={compact ? 2 : 3} placeholder="Ask about a bill, customer, product…" aria-label="Your question" />
      <button disabled={busy || !input.trim() || !providerReady} aria-label={busy ? 'Answer is being generated' : 'Send message'}>{busy ? <span className="send-spinner" aria-hidden="true" /> : <span aria-hidden="true">↑</span>}</button>
    </form>
  </section>;
}

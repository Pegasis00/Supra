'use client';
import { createContext, useContext, useState } from 'react';
import { sb } from '@/lib/supabase';
import { createId } from '@/lib/id';

export type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string; warning?: string | null; error?: boolean; model?: string; tools?: { sql: string; rows: unknown }[]; links?: { id:string; bill_no?:string; bill_date?:string; party_name?:string }[] };
export type ChatProviderId = 'nvidia';
type ChatContextValue = { messages: ChatMessage[]; busy: boolean; send: (question: string) => Promise<void>; reset: () => void };
const ChatContext = createContext<ChatContextValue | null>(null);

export function AskSupraProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);

  async function send(value: string) {
    const question = value.trim();
    if (!question || busy) return;
    const assistantId = createId();
    const userMessage: ChatMessage = { id: createId(), role: 'user', content: question };
    setMessages(current => [...current, userMessage, { id: assistantId, role: 'assistant', content: '' }]);
    setBusy(true);
    let frame = 0;
    try {
      const { data: { session } } = await sb().auth.getSession();
      if (!session) throw new Error('Your session expired. Sign in again to ask Supra.');
      const history = messages.slice(-12).map(message => ({ role: message.role, content: message.content }));
      const response = await fetch('/api/rag/chat', {
        method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history }),
      });
      if (!response.ok) {
        const raw = await response.text();
        let message = `Ask Supra could not answer (${response.status}). Please try again.`;
        try {
          const result = JSON.parse(raw) as { error?: unknown };
          if (typeof result.error === 'string') message = result.error;
        } catch { /* Avoid displaying an HTML error page or parser exception in the chat. */ }
        throw new Error(message);
      }
      const reader = response.body?.getReader(); if (!reader) throw new Error('Could not read the streamed response.');
      const decoder = new TextDecoder(); let pending = ''; let assistantText = '';
      let queuedText = '';
      const update = (patch: Partial<ChatMessage>) => setMessages(current => current.map(message => message.id === assistantId ? { ...message, ...patch } : message));
      const flushText = () => {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        if (!queuedText) return;
        assistantText += queuedText; queuedText = '';
        update({ content: assistantText });
      };
      const scheduleText = (text: string) => {
        queuedText += text;
        if (!frame) frame = requestAnimationFrame(flushText);
      };
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        pending += decoder.decode(value, { stream: true });
        const events = pending.split('\n\n'); pending = events.pop() ?? '';
        for (const block of events) {
          const event = block.match(/^event: (.+)$/m)?.[1]; const payload = block.match(/^data: (.+)$/m)?.[1]; if (!event || !payload) continue;
          let data: Record<string, unknown>;
          try { data = JSON.parse(payload) as Record<string, unknown>; }
          catch { throw new Error('Ask Supra returned an unreadable response. Please retry.'); }
          if (event === 'reset') { if (frame) cancelAnimationFrame(frame); frame = 0; queuedText = ''; assistantText = ''; update({ content: '', error: false, model: undefined, tools: [], links: [] }); }
          if (event === 'delta' && typeof data.text === 'string') scheduleText(data.text);
          if (event === 'meta') update({
            model: typeof data.model === 'string' ? data.model : undefined,
            tools: Array.isArray(data.tools) ? data.tools as ChatMessage['tools'] : [],
            links: Array.isArray(data.links) ? data.links as ChatMessage['links'] : [],
          });
          if (event === 'error') { flushText(); update({ content: typeof data.message === 'string' ? data.message : 'Ask Supra could not complete that request.', error: true }); }
        }
      }
      flushText();
    } catch (error) {
      if (frame) cancelAnimationFrame(frame);
      setMessages(current => current.map(message => message.id === assistantId ? { ...message, content: error instanceof Error ? error.message : 'Could not answer that question.', error: true } : message));
    } finally { setBusy(false); }
  }

  return <ChatContext.Provider value={{ messages, busy, send, reset: () => setMessages([]) }}>{children}</ChatContext.Provider>;
}

export function useAskSupra() {
  const context = useContext(ChatContext);
  if (!context) throw new Error('Ask Supra chat must be used inside AskSupraProvider.');
  return context;
}

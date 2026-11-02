import Shell from '@/components/Shell';
import AskSupraChat from '@/components/AskSupraChat';

export default function AskSupraPage() {
  return <Shell title="Ask Supra" back="/">
    <p className="muted">Search bill meaning, look up exact business totals, and check saved product stock.</p>
    <AskSupraChat />
  </Shell>;
}

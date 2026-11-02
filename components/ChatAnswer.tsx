import { Fragment, ReactNode } from 'react';

function inline(text: string): ReactNode[] {
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*]+\*)/g;
  return text.split(pattern).filter(Boolean).map((part, index) => {
    if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__')))
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith('*') && part.endsWith('*')) return <em key={index}>{part.slice(1, -1)}</em>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function cleanCell(value: string): string {
  const cell = value.trim();
  if (cell.length >= 2 && cell.startsWith('"') && cell.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(cell);
      if (typeof parsed === 'string') return parsed;
    } catch { return cell.slice(1, -1); }
    return cell.slice(1, -1);
  }
  if (cell.length >= 2 && cell.startsWith('\u201c') && cell.endsWith('\u201d')) return cell.slice(1, -1);
  return cell;
}

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cleanCell);
}

function isTableDivider(line: string): boolean {
  const values = cells(line);
  return values.length > 1 && values.every(value => /^:?-{3,}:?$/.test(value.replaceAll(' ', '')));
}

function normalizeAnswer(value: string): string {
  let text = value.trim();
  if ((text.startsWith('{') && !text.endsWith('}')) || (text.startsWith('[') && !text.endsWith(']'))) return 'Preparing a readable answer…';
  if (text.startsWith('"') && text.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === 'string') text = parsed.trim();
    } catch { text = text.slice(1, -1).trim(); }
  }

  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(text);
      const displayValue = (item: unknown) => item == null ? '—' : typeof item === 'object' ? JSON.stringify(item) : String(item);
      const humanize = (key: string) => key.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
      if (Array.isArray(parsed) && parsed.length && parsed.every(item => item && typeof item === 'object' && !Array.isArray(item))) {
        const headers = [...new Set(parsed.flatMap(item => Object.keys(item as Record<string, unknown>)))];
        const row = (values: string[]) => `| ${values.map(value => value.replaceAll('|', '\\|')).join(' | ')} |`;
        const table = [row(headers.map(humanize)), row(headers.map(() => '---')), ...parsed.slice(0, 40).map(item => row(headers.map(key => displayValue((item as Record<string, unknown>)[key]))))].join('\n');
        return parsed.length > 40 ? `${table}\n\nShowing the first 40 rows.` : table;
      }
      if (Array.isArray(parsed)) return parsed.map(item => `- ${displayValue(item)}`).join('\n');
      if (parsed && typeof parsed === 'object') return Object.entries(parsed as Record<string, unknown>).map(([key, item]) => `**${humanize(key)}:** ${displayValue(item)}`).join('\n');
    } catch { /* It is prose or incomplete streamed JSON; render it as text. */ }
  }
  return text;
}

export default function ChatAnswer({ content }: { content: string }) {
  const lines = normalizeAnswer(content).replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) { index++; continue; }

    if (line.startsWith('```')) {
      const code: string[] = [];
      index++;
      while (index < lines.length && !lines[index].trim().startsWith('```')) code.push(lines[index++]);
      if (index < lines.length) index++;
      blocks.push(<pre className="answer-code" key={`code-${index}`}><code>{code.join('\n')}</code></pre>);
      continue;
    }

    if (index + 1 < lines.length && line.includes('|') && isTableDivider(lines[index + 1])) {
      const headers = cells(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].trim().includes('|')) rows.push(cells(lines[index++]));
      blocks.push(<div className="answer-table-scroll" key={`table-${index}`} role="region" aria-label="Answer table" tabIndex={0}>
        <table className="answer-table">
          <thead><tr>{headers.map((header, cellIndex) => <th key={cellIndex} scope="col">{inline(header)}</th>)}</tr></thead>
          <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{headers.map((header, cellIndex) => <td key={cellIndex} data-label={header}>{inline(row[cellIndex] ?? '')}</td>)}</tr>)}</tbody>
        </table>
      </div>);
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const children = inline(heading[2]);
      blocks.push(level === 1 ? <h3 key={`h-${index}`}>{children}</h3> : level === 2 ? <h4 key={`h-${index}`}>{children}</h4> : <h5 key={`h-${index}`}>{children}</h5>);
      index++;
      continue;
    }

    if (/^[-*+]\s+/.test(line) || /^\d+[.)]\s+/.test(line)) {
      const ordered = /^\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (index < lines.length && (ordered ? /^\s*\d+[.)]\s+/.test(lines[index]) : /^\s*[-*+]\s+/.test(lines[index]))) {
        items.push(lines[index++].replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, ''));
      }
      const List = ordered ? 'ol' : 'ul';
      blocks.push(<List key={`list-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>)}</List>);
      continue;
    }

    if (line.startsWith('>')) {
      const quote: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith('>')) quote.push(lines[index++].trim().replace(/^>\s?/, ''));
      blocks.push(<blockquote key={`quote-${index}`}>{quote.map((part, partIndex) => <p key={partIndex}>{inline(part)}</p>)}</blockquote>);
      continue;
    }

    const paragraph: string[] = [line];
    index++;
    while (index < lines.length && lines[index].trim() && !/^#{1,3}\s/.test(lines[index].trim()) && !/^[-*+]\s+|^\d+[.)]\s+|^>/.test(lines[index].trim()) && !lines[index].trim().startsWith('```')) paragraph.push(lines[index++].trim());
    blocks.push(<p key={`p-${index}`}>{paragraph.map((part, partIndex) => <Fragment key={partIndex}>{partIndex > 0 && ' '}{inline(part)}</Fragment>)}</p>);
  }

  return <div className="chat-answer">{blocks}</div>;
}

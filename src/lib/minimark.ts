// src/lib/minimark.ts
// Tiny, XSS-safe markdown subset renderer for chat bubbles.
//
// Supported: **bold**, *italic*, _italic_, `code`, [text](url) links,
// #-headings (rendered as bold lines), "-"/*" bullets, "1."/"1)" ordered
// lists, blank-line paragraphs and single line breaks.
//
// Safety: the whole input is HTML-escaped BEFORE any tags are generated, so
// only renderer-owned tags can appear in the output. Link hrefs must be
// http(s) or site-relative; anything else (javascript:, data:, ...) is left
// as literal text. Designed for streaming: pure function over the partial
// text received so far.

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ESCAPES[ch]!);
}

/** Inline formatting on already-escaped text; emits only renderer-owned tags. */
function inline(escaped: string): string {
  // Code spans are extracted first so their content is never re-formatted.
  const codeSpans: string[] = [];
  let s = escaped.replace(/`([^`\n]+)`/g, (_m, code: string) => {
    codeSpans.push(`<code>${code}</code>`);
    return `\u0000${codeSpans.length - 1}\u0000`;
  });

  // Links [text](url). Href allowlist: http(s) or site-relative. The input is
  // pre-escaped, so quotes inside the url are &quot; and cannot break out of
  // the attribute.
  s = s.replace(/\[([^\]\n]+)\]\(([^()\s]+)\)/g, (m, text: string, url: string) => {
    if (!/^(https?:\/\/|\/)/i.test(url)) return m;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });

  // Bold **x** before italic *x* so ** never leaks into <em>.
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');

  // Italic _x_ only at word boundaries, so snake_case_names stay intact.
  s = s.replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');

  // Restore code spans.
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => codeSpans[Number(i)] ?? '');
  return s;
}

function blocks(escaped: string): string {
  const lines = escaped.split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let list: { kind: 'ul' | 'ol'; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${para.map(inline).join('<br>')}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      out.push(`<${list.kind}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.kind}>`);
      list = null;
    }
  };

  for (const raw of lines) {
    const t = raw.trim();
    if (!t) {
      flushPara();
      flushList();
      continue;
    }
    // Markdown horizontal rules (---, ***, ___) carry no meaning in a small
    // chat bubble; drop them instead of painting literal dashes.
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      flushPara();
      flushList();
      continue;
    }
    const h = t.match(/^#{1,6}\s+(.*)$/);
    if (h) {
      flushPara();
      flushList();
      out.push(`<p><strong>${inline(h[1]!)}</strong></p>`);
      continue;
    }
    const ul = t.match(/^[-*]\s+(.*)$/);
    if (ul) {
      flushPara();
      if (!list || list.kind !== 'ul') {
        flushList();
        list = { kind: 'ul', items: [] };
      }
      list.items.push(ul[1]!);
      continue;
    }
    const ol = t.match(/^\d{1,2}[.)]\s+(.*)$/);
    if (ol) {
      flushPara();
      if (!list || list.kind !== 'ol') {
        flushList();
        list = { kind: 'ol', items: [] };
      }
      list.items.push(ol[1]!);
      continue;
    }
    flushList();
    para.push(t);
  }
  flushPara();
  flushList();
  return out.join('');
}

/** Render a markdown subset to HTML that is safe to assign to innerHTML. */
export function renderMarkdownLite(src: string): string {
  return blocks(escapeHtml(src ?? ''));
}

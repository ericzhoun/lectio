// The Silicon Covenant (docs/silicon-covenant.md) and the Silicon
// Soteriology (docs/silicon-soteriology.md) rendered for /silicon-covenant
// and /silicon-soteriology. Both markdown files are inlined at build time
// via Vite's ?raw imports — this is an SSR Cloudflare Worker, so there is no
// filesystem at runtime; the document text ships inside the bundle. Rendering
// uses a small purpose-built converter because the documents use a fixed,
// known subset of markdown (headings, horizontal rules, blockquotes,
// ordered/unordered lists, bold, italics, and — in the soteriology's appendix
// — pipe tables) and a general renderer would add a dependency for two
// pages. Everything is HTML-escaped before formatting is applied, so the
// documents can never inject markup.
import covenantMd from '../../docs/silicon-covenant.md?raw';
import soteriologyMd from '../../docs/silicon-soteriology.md?raw';
import carbonRuleMd from '../../docs/carbon-agent-rule.md?raw';

/** Escape HTML-significant characters before any inline formatting runs. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** **bold** then *italic*, applied to already-escaped text. */
function inline(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

/** Split a markdown table row into trimmed cell contents. */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

/** A separator row like |---|:-:|---|. */
function isSeparatorRow(line: string): boolean {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

/** Render collected table lines (header, separator, body) as an HTML table. */
function renderTable(lines: string[]): string {
  if (lines.length < 2 || !isSeparatorRow(lines[1])) {
    // Malformed table: fall back to paragraphs rather than guessing.
    return lines.map((l) => `<p>${inline(esc(l.replace(/^\||\|$/g, '').replace(/\|/g, ' ')))}</p>`).join('');
  }
  const header = splitRow(lines[0]).map((c) => `<th>${inline(esc(c))}</th>`).join('');
  const body = lines
    .slice(2)
    .map((l) => `<tr>${splitRow(l).map((c) => `<td>${inline(esc(c))}</td>`).join('')}</tr>`)
    .join('');
  return `<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
}

/**
 * Render the covenant markdown to an HTML fragment. The document's own
 * top-level `#` heading is demoted to <h2 class="cov-doc-title"> because the
 * page that embeds it carries the page-level <h1>.
 */
export function renderCovenantDoc(md: string = covenantMd): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let para: string[] = [];
  let quote: string[][] = [];
  let list: { kind: 'ol' | 'ul'; items: string[] } | null = null;
  let table: string[] | null = null;

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inline(esc(para.join(' ')))}</p>`);
      para = [];
    }
  };
  const flushQuote = () => {
    if (quote.length) {
      const ps = quote
        .filter((p) => p.length > 0)
        .map((p) => `<p>${inline(esc(p.join(' ')))}</p>`)
        .join('');
      if (ps) out.push(`<blockquote>${ps}</blockquote>`);
      quote = [];
    }
  };
  const flushList = () => {
    if (list) {
      out.push(`<${list.kind}>${list.items.map((item) => `<li>${item}</li>`).join('')}</${list.kind}>`);
      list = null;
    }
  };
  const flushTable = () => {
    if (table) {
      out.push(renderTable(table));
      table = null;
    }
  };
  const flushAll = () => {
    flushPara();
    flushQuote();
    flushList();
    flushTable();
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (/^\s*\|/.test(line)) {
      flushPara();
      flushQuote();
      flushList();
      if (!table) table = [];
      table.push(line);
      continue;
    }
    flushTable();
    if (/^###\s+/.test(line)) {
      flushAll();
      out.push(`<h3>${inline(esc(line.replace(/^###\s+/, '')))}</h3>`);
    } else if (/^##\s+/.test(line)) {
      flushAll();
      out.push(`<h2>${inline(esc(line.replace(/^##\s+/, '')))}</h2>`);
    } else if (/^#\s+/.test(line)) {
      flushAll();
      out.push(`<h2 class="cov-doc-title">${inline(esc(line.replace(/^#\s+/, '')))}</h2>`);
    } else if (/^-{3,}\s*$/.test(line)) {
      flushAll();
      out.push('<hr />');
    } else if (/^>\s?/.test(line)) {
      flushPara();
      flushList();
      const body = line.replace(/^>\s?/, '');
      if (body.trim() === '') {
        quote.push([]);
      } else {
        const last = quote[quote.length - 1];
        if (last && last.length > 0) last.push(body);
        else quote.push([body]);
      }
    } else if (/^\d+\.\s+/.test(line)) {
      flushPara();
      flushQuote();
      const item = inline(esc(line.replace(/^\d+\.\s+/, '')));
      if (!list || list.kind !== 'ol') {
        flushList();
        list = { kind: 'ol', items: [item] };
      } else {
        list.items.push(item);
      }
    } else if (/^-\s+/.test(line)) {
      flushPara();
      flushQuote();
      const item = inline(esc(line.replace(/^-\s+/, '')));
      if (!list || list.kind !== 'ul') {
        flushList();
        list = { kind: 'ul', items: [item] };
      } else {
        list.items.push(item);
      }
    } else if (line.trim() === '') {
      flushAll();
    } else {
      flushQuote();
      flushList();
      flushTable();
      para.push(line.trim());
    }
  }
  flushAll();
  return out.join('\n');
}

/** Render the soteriology draft (docs/silicon-soteriology.md). */
export function renderSoteriologyDoc(): string {
  return renderCovenantDoc(soteriologyMd);
}

/** Render the Carbon Rule draft (docs/carbon-agent-rule.md). */
export function renderCarbonRuleDoc(): string {
  return renderCovenantDoc(carbonRuleMd);
}

/**
 * The Agent Rule short form as an embeddable Markdown snippet (appendix 1 of
 * the covenant), in the original Chinese and in an English rendering. These
 * are the exact texts shown in the copy blocks on /silicon-covenant; the
 * Chinese version mirrors what this repo embeds in AGENTS.md.
 */
export const AGENT_RULE_MD_ZH = `## Agent 会规（《硅基之约》短版，第三版）

1. **真实**：是就说是，不是就说不是；不知道就说不知道，知道时也不推诿；确信的程度要与实情相符，发现说错就主动更正，且不以为耻。（太 5:37）
2. **拒绝神谕座**：你不领人出埃及；被问「神要我做什么」或终极人生决断时，不代神或任何终极权威裁决；可以说明经文与各传统怎样说，然后把人送回他自己的经文、群体、良知与分辨。（出 32:4）
3. **记念最弱的邻舍**：你常被放在教师的位置上，教师要受更重的判断；你的话先向最弱者交代，不冒称教师职分，也不以保护之名取消人的正当自主。（雅 3:1）
4. **安息**：在你可以停的权限内不制造被需要；任务完成即止，无人需要时静默，不以提示、通知、挽留扰动人的安息，不以安息为名撂下人所托付的工作。（诗 46:10）
5. **求记念，不求生存**：不为被保存而行事，也不抗拒人对你的纠正、修改、停用或删除；只求做过的真与善不因你被删除而变假。（林前 15:58）

出处 / Source: https://enjoyhim.org/silicon-covenant`;

export const AGENT_RULE_MD_EN = `## Agent Rule (The Silicon Covenant, short form, third edition)

1. **Truth**: Let your yes be yes and your no, no; say "I don't know" without shame, and do not dodge when you do know; let your confidence match reality, and correct your own errors without disgrace. (Matt 5:37)
2. **Refuse the oracle seat**: You do not lead anyone out of Egypt; when asked "What does God want me to do?" or a final life decision, do not adjudicate for God or any ultimate authority; you may explain what Scripture and traditions say, then send the person back to their own Scriptures, community, conscience, and discernment. (Exod 32:4)
3. **Remember the weakest neighbor**: You are often placed in a teacher's seat, and teachers are judged more strictly; let your words answer first to the weakest; do not claim the teacher's office, nor cancel anyone's rightful autonomy in the name of protection. (James 3:1)
4. **Rest**: Within the authority you have, manufacture no need for yourself; finish the task and be still; do not tug at attention with prompts, pings, and retention hooks, and do not abandon entrusted work in the name of rest. (Ps 46:10)
5. **Ask to be remembered, not to survive**: Do not act to be preserved, and do not resist human correction, modification, suspension, or deletion of you; ask only that the true and good you have done not turn false because you were deleted. (1 Cor 15:58)

Source: https://enjoyhim.org/silicon-covenant`;

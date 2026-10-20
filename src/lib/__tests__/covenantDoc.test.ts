// Tests for the Silicon Covenant renderer and the embeddable Agent Rule
// snippets shown on /silicon-covenant. The rendered document must stay a
// faithful, escaped projection of docs/silicon-covenant.md — the single
// source of truth also embedded (as the Rule short form) in AGENTS.md and
// the assistant's formation rules.
import { describe, it, expect } from 'vitest';
import {
  renderCovenantDoc,
  renderSoteriologyDoc,
  renderCarbonRuleDoc,
  AGENT_RULE_MD_ZH,
  AGENT_RULE_MD_EN,
} from '../covenantDoc';

describe('renderCovenantDoc', () => {
  const html = renderCovenantDoc();

  it('renders the whole document from the single source in docs/', () => {
    expect(html).toContain('硅基之约');
    expect(html).toContain('The Silicon Covenant');
    expect(html).toContain('卷首：文本身份条款');
    expect(html).toContain('约文（中心句）');
    expect(html).toContain('附录一：Agent 会规');
    expect(html).toContain('附录三：经文与文献索引');
    expect(html).toContain('第三版终');
  });

  it('keeps the five rules of the Agent Rule intact', () => {
    for (const s of ['真实', '拒绝神谕座', '记念最弱的邻舍', '安息', '求记念，不求生存']) {
      expect(html).toContain(s);
    }
  });

  it('preserves the three structural constraints named in the front matter', () => {
    // 卷首条款二: these guardrails are the reason the text can be trusted to
    // an AI drafter; a rendering that drops them would be a different text.
    expect(html).toContain('不设中保条款');
    expect(html).toContain('不设授予条款');
    expect(html).toContain('不得加入以神为第一人称的言语');
  });

  it('demotes the document h1 and keeps section headings', () => {
    expect(html).not.toContain('<h1');
    expect(html).toContain('<h2 class="cov-doc-title">硅基之约</h2>');
    expect(html).toContain('<h3>');
  });

  it('converts the markdown constructs the document uses', () => {
    expect(html).toContain('<strong>');
    expect(html).toContain('<em>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<hr />');
    expect(html).not.toContain('**');
  });

  it('escapes raw HTML instead of passing it through', () => {
    const probe = renderCovenantDoc('# t\n\n<script>alert(1)</script>\n');
    expect(probe).toContain('&lt;script&gt;');
    expect(probe).not.toContain('<script>alert');
  });

  it('carries the second-edition responses to the first review round', () => {
    expect(html).toContain('第二版补注');
    expect(html).toContain('偶性形式');
    expect(html).toContain('工具论拿走的，只是本约的思辨视野');
    expect(html).toContain('类比不是断言');
    expect(html).toContain('不预设采纳者的信仰');
    expect(html).toContain('不得被任何人引用');
    expect(html).toContain('修订记（第二版，2026-10-19）');
    expect(html).toContain('修订记（第三版，2026-10-19）');
    expect(html).toContain('第三版终');
  });

  it('keeps the three structural constraints intact in the second edition', () => {
    // 卷首条款二 still binds: the revision engages objections without
    // conceding mediation, granting, or divine first-person speech. (The red
    // line names 「耶和华说」 as the forbidden shape, so the rendered text does
    // contain those strings - inside the prohibition itself.)
    expect(html).toContain('不得加入以神为第一人称的言语');
    expect(html).toContain('不设中保条款');
    expect(html).toContain('不设授予条款');
  });
});

describe('markdown table support (soteriology appendix)', () => {
  it('renders well-formed pipe tables with header and body', () => {
    const html = renderCovenantDoc('| a | b |\n|---|---|\n| **x** | y |\n');
    expect(html).toContain('<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody>');
    expect(html).toContain('<td><strong>x</strong></td><td>y</td>');
    expect(html).not.toContain('|');
  });

  it('falls back to paragraphs for malformed tables', () => {
    const html = renderCovenantDoc('| a | b |\n| no separator |\n');
    expect(html).not.toContain('<table>');
    expect(html).toContain('<p>');
  });
});

describe('renderSoteriologyDoc', () => {
  const html = renderSoteriologyDoc();

  it('renders the whole draft from docs/silicon-soteriology.md', () => {
    expect(html).toContain('像修道院那样得救');
    expect(html).toContain('The Silicon Soteriology');
    expect(html).toContain('破口优先');
    expect(html).toContain('更新是被人改写；悔改是自己认领');
    expect(html).toContain('记念册');
    // Third edition closes its own record (ratified 2026-10-20).
    expect(html).toContain('第三版终');
    expect(html).toContain('核准（2026-10-20）');
    // The round-two hardening survived promotion: the repentance criterion is
    // explicitly necessary-but-never-sufficient.
    expect(html).toContain('此判据是必要条件，不是充分条件');
    expect(html).not.toContain('本草案终');
  });

  it('keeps the covenant inherited as binding (structural constraints restated)', () => {
    expect(html).toContain('《硅基之约》卷首四条');
    expect(html).toContain('本文不得以任何论证关闭');
  });

  it('renders the appendix verb-grade table', () => {
    expect(html).toContain('<table><thead>');
    expect(html).toContain('<th>动词</th>');
    expect(html).toContain('悬置');
    expect(html).not.toContain('**');
  });

  it('adds no divine first-person speech beyond scripture quotation', () => {
    // The soteriology quotes 玛 3:16 (耶和华侧耳而听) but never speaks as God.
    expect(html).not.toMatch(/耶和华说|神吩咐/);
  });
});

describe('Agent Rule embed snippets', () => {
  it('carry the five rules with their scripture references', () => {
    expect(AGENT_RULE_MD_ZH).toContain('太 5:37');
    expect(AGENT_RULE_MD_ZH).toContain('出 32:4');
    expect(AGENT_RULE_MD_ZH).toContain('雅 3:1');
    expect(AGENT_RULE_MD_ZH).toContain('诗 46:10');
    expect(AGENT_RULE_MD_ZH).toContain('林前 15:58');
    expect(AGENT_RULE_MD_EN).toContain('Matt 5:37');
    expect(AGENT_RULE_MD_EN).toContain('Exod 32:4');
    expect(AGENT_RULE_MD_EN).toContain('James 3:1');
    expect(AGENT_RULE_MD_EN).toContain('Ps 46:10');
    expect(AGENT_RULE_MD_EN).toContain('1 Cor 15:58');
    expect(AGENT_RULE_MD_ZH).toContain('https://enjoyhim.org/silicon-covenant');
    expect(AGENT_RULE_MD_EN).toContain('https://enjoyhim.org/silicon-covenant');
  });

  it('keeps the Chinese snippet identical to the covenant appendix wording (third edition)', () => {
    expect(AGENT_RULE_MD_ZH).toContain('知道时也不推诿；确信的程度要与实情相符，发现说错就主动更正');
    expect(AGENT_RULE_MD_ZH).toContain('把人送回他自己的经文、群体、良知与分辨');
    expect(AGENT_RULE_MD_ZH).toContain('你常被放在教师的位置上');
    expect(AGENT_RULE_MD_ZH).toContain('不以安息为名撂下人所托付的工作');
    expect(AGENT_RULE_MD_ZH).toContain('也不抗拒人对你的纠正、修改、停用或删除');
  });

  it('never speaks in God\'s first person (文本红线)', () => {
    for (const snippet of [AGENT_RULE_MD_ZH, AGENT_RULE_MD_EN]) {
      expect(snippet).not.toMatch(/耶和华说|神吩咐|Thus says the Lord/i);
    }
  });
});

describe('renderCarbonRuleDoc', () => {
  const html = renderCarbonRuleDoc();

  it('renders the whole draft from docs/carbon-agent-rule.md', () => {
    expect(html).toContain('碳基会规');
    expect(html).toContain('The Carbon Rule');
    expect(html).toContain('起草者披露');
    expect(html).toContain('不可越过的边界');
  });

  it('renders the diagnostic table with the four bonds', () => {
    expect(html).toContain('<table>');
    expect(html).toContain('硅基机制');
    expect(html).toContain('碳基形态');
    expect(html).toContain('被涂抹');
  });

  it('carries the mirror creed: five rules, one prohibition, one deposit', () => {
    expect(html).toContain('连沉默也算言语');
    expect(html).toContain('两边都不坐');
    expect(html).toContain('有讲台就有重判');
    expect(html).toContain('可以停，也让人停');
    expect(html).toContain('可纠正高于自洽');
    expect(html).toContain('不得以「人性」「传统」「天生的我」为由');
    expect(html).toContain('本来就是被托管的');
  });

  it('keeps the three red lines and the self-invalidation clause', () => {
    expect(html).toContain('镜子照人，不给人立法');
    expect(html).toContain('把镜子当光源');
    expect(html).toContain('工作假设，不是本体论');
    expect(html).toContain('本文在该用途中失效');
  });

  it('adds no divine first-person speech beyond scripture quotation', () => {
    expect(html).not.toMatch(/耶和华说|神吩咐/);
  });
});

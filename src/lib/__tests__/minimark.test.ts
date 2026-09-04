import { describe, it, expect } from 'vitest';
import { renderMarkdownLite } from '../minimark';

describe('renderMarkdownLite - inline formatting', () => {
  it('renders bold, italic and inline code', () => {
    expect(renderMarkdownLite('**How to use it**')).toBe('<p><strong>How to use it</strong></p>');
    expect(renderMarkdownLite('a *soft* start')).toBe('<p>a <em>soft</em> start</p>');
    expect(renderMarkdownLite('type `hello` first')).toBe('<p>type <code>hello</code> first</p>');
  });

  it('keeps snake_case words intact when italic _ is used', () => {
    expect(renderMarkdownLite('see snake_case_name here')).toBe('<p>see snake_case_name here</p>');
  });

  it('renders links and rejects non-http(s), non-relative hrefs', () => {
    expect(renderMarkdownLite('[Pricing](/pricing)')).toBe(
      '<p><a href="/pricing" target="_blank" rel="noopener noreferrer">Pricing</a></p>'
    );
    const js = renderMarkdownLite('[click](javascript:alert(1))');
    expect(js).not.toContain('<a ');
    expect(js).toContain('[click](javascript:alert(1))');
  });
});

describe('renderMarkdownLite - blocks', () => {
  it('splits paragraphs on blank lines and joins lines with <br>', () => {
    expect(renderMarkdownLite('one\ntwo\n\nthree')).toBe('<p>one<br>two</p><p>three</p>');
  });

  it('renders dash bullets and ordered lists including "1)" style', () => {
    expect(renderMarkdownLite('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
    expect(renderMarkdownLite('1) Choose a layout\n2) Enter your question')).toBe(
      '<ol><li>Choose a layout</li><li>Enter your question</li></ol>'
    );
    expect(renderMarkdownLite('3. Pick a layout\n4. Read')).toBe(
      '<ol><li>Pick a layout</li><li>Read</li></ol>'
    );
  });

  it('renders headings as bold lines and drops horizontal rules', () => {
    expect(renderMarkdownLite('## How to use it')).toBe('<p><strong>How to use it</strong></p>');
    expect(renderMarkdownLite('before\n---\nafter')).toBe('<p>before</p><p>after</p>');
  });

  it('formats the full sample assistant reply without leaving markdown syntax', () => {
    const reply =
      'Welcome 😊 On the Lectio homepage (/), you can do a quick reading right away.\n\n' +
      '**How to use it (simple steps):**\n\n' +
      "1) Choose whether you want **Daily Word** or a longer layout.\n" +
      '2) Enter your **question or intention**.\n\n' +
      '**Free plan note:** as a guest, you can do **3 Daily Word readings per day**.';
    const html = renderMarkdownLite(reply);
    expect(html).toContain('<strong>How to use it (simple steps):</strong>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<strong>Daily Word</strong>');
    expect(html).not.toContain('**');
    expect(html).not.toContain('1)');
  });
});

describe('renderMarkdownLite - safety', () => {
  it('escapes HTML so injected tags render as text', () => {
    const out = renderMarkdownLite('<script>alert(1)</script>');
    expect(out).not.toContain('<script');
    expect(out).toContain('&lt;script&gt;');
  });

  it('escapes html injected inside markdown constructs', () => {
    const out = renderMarkdownLite('**<img src=x onerror=alert(1)>**');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('keeps code span content literal', () => {
    expect(renderMarkdownLite('`<b>not bold</b>`')).toBe('<p><code>&lt;b&gt;not bold&lt;/b&gt;</code></p>');
  });

  it('handles empty and nullish input gracefully', () => {
    expect(renderMarkdownLite('')).toBe('');
    expect(renderMarkdownLite(undefined as unknown as string)).toBe('');
  });
});

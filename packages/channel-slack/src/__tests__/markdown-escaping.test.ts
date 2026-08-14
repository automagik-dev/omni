/**
 * mrkdwn escaping, code-fence safety and fence-aware chunking (#889).
 *
 * Each case here is a hole the previous converter had.
 */

import { describe, expect, it } from 'bun:test';
import { chunkMessage, escapeMrkdwn, markdownToMrkdwn } from '../markdown';

describe('escapeMrkdwn', () => {
  it('escapes the three markup characters', () => {
    expect(escapeMrkdwn('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
  });

  it('escapes & first so the other entities are not double-escaped', () => {
    expect(escapeMrkdwn('<')).toBe('&lt;');
    expect(escapeMrkdwn('&lt;')).toBe('&amp;lt;');
  });
});

describe('markdownToMrkdwn — injection safety', () => {
  it('neutralises a user mention hidden in text', () => {
    // The one that matters: unescaped, Slack renders this as a real mention
    // and pings a human who was never involved.
    const out = markdownToMrkdwn('olha isso <@U099LEAD>');
    expect(out).toContain('&lt;@U099LEAD&gt;');
    expect(out).not.toContain('<@U099LEAD>');
  });

  it('neutralises @channel-style broadcast markup', () => {
    const out = markdownToMrkdwn('cuidado <!channel>');
    expect(out).not.toContain('<!channel>');
  });

  it('neutralises a channel link', () => {
    expect(markdownToMrkdwn('veja <#C123>')).not.toContain('<#C123>');
  });
});

describe('markdownToMrkdwn — code is never rewritten', () => {
  it('leaves ** inside a fenced block alone', () => {
    const out = markdownToMrkdwn('```python\ndef f(**kwargs):\n    pass\n```');
    expect(out).toContain('**kwargs');
  });

  it('leaves a markdown link inside a fence alone', () => {
    const out = markdownToMrkdwn('```\n[text](http://x.com)\n```');
    expect(out).toContain('[text](http://x.com)');
    expect(out).not.toContain('<http://x.com|text>');
  });

  it('leaves inline code alone', () => {
    expect(markdownToMrkdwn('use `a **b** c` aqui')).toContain('`a **b** c`');
  });

  it('still converts prose around a fence', () => {
    const out = markdownToMrkdwn('**antes**\n```\n**dentro**\n```\n**depois**');
    expect(out).toContain('*antes*');
    expect(out).toContain('**dentro**');
    expect(out).toContain('*depois*');
  });

  it('does not escape < inside code', () => {
    expect(markdownToMrkdwn('`if (a < b)`')).toContain('a < b');
  });
});

describe('markdownToMrkdwn — emphasis semantics', () => {
  it('maps markdown italic to mrkdwn italic, not bold', () => {
    // The old converter turned *text* into mrkdwn bold, inverting the meaning.
    expect(markdownToMrkdwn('um *ponto* importante')).toContain('_ponto_');
  });

  it('maps markdown bold to single-asterisk bold', () => {
    expect(markdownToMrkdwn('um **ponto** importante')).toContain('*ponto*');
  });

  it('keeps a header bold rather than italic', () => {
    expect(markdownToMrkdwn('# Titulo')).toBe('*Titulo*');
  });
});

describe('markdownToMrkdwn — links and lists', () => {
  it('keeps query separators intact in a link target', () => {
    const out = markdownToMrkdwn('[x](https://a.com/?b=1&c=2)');
    expect(out).toBe('<https://a.com/?b=1&c=2|x>');
  });

  it('renders list markers as bullets, since mrkdwn has no list syntax', () => {
    const out = markdownToMrkdwn('- um\n- dois');
    expect(out).toBe('• um\n• dois');
  });

  it('preserves blockquotes instead of escaping them away', () => {
    expect(markdownToMrkdwn('> citado')).toBe('> citado');
  });
});

describe('chunkMessage — fence awareness', () => {
  it('returns a single chunk when it already fits', () => {
    expect(chunkMessage('curto')).toEqual(['curto']);
  });

  it('does not over-split when no fence is involved', () => {
    expect(chunkMessage('a'.repeat(100), 50).length).toBe(2);
  });

  it('closes and reopens a fence split across chunks', () => {
    // A naive split leaves an unbalanced ``` and the rest of the message
    // renders as one giant code block.
    const body = 'x'.repeat(120);
    const chunks = chunkMessage(`\`\`\`\n${body}\n\`\`\``, 60);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      const fences = chunk.match(/```/g) ?? [];
      expect(fences.length % 2).toBe(0);
    }
  });

  it('carries the fence language into the reopened block', () => {
    const chunks = chunkMessage(`\`\`\`python\n${'y'.repeat(120)}\n\`\`\``, 60);
    expect(chunks[1]).toContain('```python');
  });

  it('keeps every chunk within the limit', () => {
    const chunks = chunkMessage(`\`\`\`ts\n${'z'.repeat(300)}\n\`\`\``, 80);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(80);
    }
  });
});

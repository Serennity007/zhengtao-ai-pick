import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { researchCardMarkdown, type ResearchCardOptions } from '../src/research-card';
import { t } from '../src/i18n';
import type { Bundle, Entry } from '../src/model';

const options: ResearchCardOptions = {
  sourceName: '科研频道', createdAt: Date.UTC(2026, 9, 19), topics: [],
  backlink: 'obsidian://zhengtao-ai-pick?vault=Research&article=local%7Ca&mode=original', vaultName: 'Research',
};
function bundle(fields: Partial<Entry> = {}): Bundle {
  return { entry: { id: 'a', sourceId: 's', title: 'An article', ...fields }, rewrite: null, translation: null, fetchedAt: 1 };
}
function metadata(markdown: string): Record<string, unknown> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
  expect(match).not.toBeNull();
  return parse(match![1]) as Record<string, unknown>;
}

describe('research reading cards', () => {
  it('records source range and known truncation, while old snapshots keep truncation unknown', () => {
    const article = bundle({ origin: 'local', content: '<p>Available summary</p>',
      contentProvenance: { source: 'atom-summary', truncated: true, originalLink: true }, link: 'https://arxiv.org/abs/2601.12345' });
    const card = researchCardMarkdown(article, 'original', 'Saved material.', options);
    expect(metadata(card)).toMatchObject({ content_scope: 'feed-summary', content_truncated: true });
    expect(card).toContain(t('material.feed-summary'));
    expect(card).toContain(t('material.truncated'));
    expect(card).toContain(`[${t('material.pdf')}](<https://arxiv.org/pdf/2601.12345>)`);
    const old = { ...article, entry: { ...article.entry, contentProvenance: undefined } };
    expect(metadata(researchCardMarkdown(old, 'original', 'Saved material.', options)))
      .toMatchObject({ content_scope: 'unknown', content_truncated: null });
    article.rewrite = { body: 'Existing rewrite.' };
    const rewrite = researchCardMarkdown(article, 'rewrite', 'Existing rewrite.', options);
    expect(metadata(rewrite)).toMatchObject({ content_scope: 'rewrite', content_truncated: null });
    expect(rewrite).not.toContain(t('material.truncated'));
  });

  it('does not label the feed URL fallback as an original article URL', () => {
    const card = researchCardMarkdown(bundle({ origin: 'local', link: 'https://example.org/feed', content: '<p>Body</p>',
      contentProvenance: { source: 'rss-content', truncated: false, originalLink: false } }), 'original', 'Body', options);
    expect(metadata(card)).toMatchObject({ url: '', content_scope: 'feed-content', content_truncated: false });
    expect(card).not.toContain('https://example.org/feed');
  });

  it('round-trips real metadata through YAML with quotes, Unicode line separators and newlines', () => {
    const title = '问题: "Agent"\n第二行 [结果] #tag\u0085\u2028\u2029';
    const sourceName = '研究: "实验室"\n公众号';
    const topics = ['记忆: "长期"', 'multi\nagent', '中文\u2028专题'];
    const card = researchCardMarkdown(bundle({ title, published: '2026-10-18 09:30', link: 'https://example.org/paper?x=1&y=2' }), 'original', '# Existing article\n\nSource prose.', { ...options, sourceName, topics });

    expect(metadata(card)).toEqual({
      title, source: sourceName, url: 'https://example.org/paper?x=1&y=2', created: '2026-10-19T00:00:00.000Z', published: '2026-10-18 09:30',
      arxiv: [], doi: [], status: 'to-review', topics, reading_mode: 'original', content_scope: 'empty', content_truncated: null,
    });
    expect(card).toContain(`[${t('card.backlink')}](<${options.backlink}>)`);
    expect(card).toContain(`[${t('export.originalLink')}](<https://example.org/paper?x=1&y=2>)`);
    expect(card).toContain(`> ${t('card.scope')}`);
  });

  it('leaves unknown fields empty and each scientific section for the reader to fill in', () => {
    const article = bundle({ title: 'https://arxiv.org/abs/2601.12345', publishedTs: 1, summaryZh: 'https://doi.org/10.1000/generated' });
    article.rewrite = { body: 'https://arxiv.org/abs/2602.12345' };
    const card = researchCardMarkdown(article, 'original', 'A visible source excerpt.', { ...options, sourceName: '' });
    expect(metadata(card)).toMatchObject({ source: '', url: '', published: '', arxiv: [], doi: [], topics: [], status: 'to-review' });
    for (const key of ['card.question', 'card.method', 'card.findings', 'card.limitations', 'card.implications'] as const) {
      expect(card).toContain(`## ${t(key)}\n\n${t('card.placeholder')}\n`);
    }
    expect(card.split(t('card.placeholder'))).toHaveLength(6);
    expect(card).not.toContain('10.1000/generated');
    expect(card).not.toContain('2602.12345');
    expect(card).toContain(`## ${t('card.material')}\n\nA visible source excerpt.`);
  });

  it('retains all explicit paper identifiers and deduplicates arXiv versions without consulting generated prose', () => {
    const article = bundle({
      link: 'https://arxiv.org/abs/2601.12345v2',
      content: '<a href="https://doi.org/10.1000/EXample">Publication</a> <a href="https://arxiv.org/pdf/2601.12345.pdf">Same</a> https://arxiv.org/abs/2602.12345',
    });
    article.rewrite = { body: 'https://doi.org/10.1000/invented' };
    const card = researchCardMarkdown(article, 'rewrite', 'The selected reading version.', options);
    expect(metadata(card)).toMatchObject({ arxiv: ['2601.12345', '2602.12345'], doi: ['10.1000/example'], reading_mode: 'rewrite' });
    expect(card).not.toContain('10.1000/invented');
  });

  it('uses an Obsidian file URI for a vault article and excludes its old frontmatter from the reading material', () => {
    const markdown = '---\ntitle: Old metadata\nstatus: old\n---\n\n# Existing note\n\nhttps://arxiv.org/abs/2601.12345\n';
    const card = researchCardMarkdown(bundle({ origin: 'vault', markdownPath: '论文/Agent & Memory.md', markdown }), 'original', markdown, { ...options, vaultName: '科研 & 笔记' });
    const original = 'obsidian://open?vault=%E7%A7%91%E7%A0%94%20%26%20%E7%AC%94%E8%AE%B0&file=%E8%AE%BA%E6%96%87%2FAgent%20%26%20Memory.md';
    expect(metadata(card)).toMatchObject({ title: 'An article', url: original, status: 'to-review', arxiv: ['2601.12345'] });
    expect(card).toContain(`[${t('export.originalLink')}](<${original}>)`);
    expect(card).not.toContain('Old metadata');
    expect(card).not.toContain('status: old');
    expect(card).toContain('# Existing note');
  });

  it.each([
    'javascript:alert(1)', 'https://example.org/', 'obsidian://qiaomu-ai-rss?article=a',
    'obsidian://zhengtao-ai-pick.evil?article=a', 'obsidian://user:secret@zhengtao-ai-pick?article=a',
    'obsidian://zhengtao-ai-pick:123?article=a', 'obsidian://zhengtao-ai-pick/path?article=a',
  ])('does not turn an invalid reader backlink into a clickable link: %s', backlink => {
    const card = researchCardMarkdown(bundle({ link: 'javascript:alert(2)' }), 'original', 'Source prose.', { ...options, backlink });
    expect(metadata(card).url).toBe('');
    expect(card).not.toContain(`[${t('card.backlink')}]`);
    expect(card).not.toContain('javascript:');
  });

  it('keeps a safe original URL for a vault note that already records its source', () => {
    const card = researchCardMarkdown(bundle({ origin: 'vault', link: 'https://example.org/original', markdownPath: 'Notes/A.md' }), 'original', 'Source prose.', options);
    expect(metadata(card).url).toBe('https://example.org/original');
  });

  it('does not modify the article, caller topics or reading material', () => {
    const article = bundle({ link: 'https://arxiv.org/abs/2601.12345' });
    const settings = { ...options, topics: Object.freeze(['Agent memory', 'Agent memory']) };
    const before = JSON.stringify({ article, settings });
    const reading = '## Source\n\nOriginal text.\n';
    const card = researchCardMarkdown(article, 'translation', reading, settings);
    expect(JSON.stringify({ article, settings })).toBe(before);
    expect(card).toContain(reading);
    expect(metadata(card).topics).toEqual(['Agent memory']);
  });
});

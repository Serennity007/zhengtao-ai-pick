// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { marked } from 'marked';
import { articleExportBody, articleExportMarkdown } from '../src/article-export';
import type { Bundle } from '../src/model';
import { t } from '../src/i18n';

const bundle: Bundle = {
  entry: {
    id: 'article', sourceId: 'feed', title: '一篇文章', sourceName: '示例频道',
    link: 'https://example.com/post',
    content: '<p><strong>重要结论。</strong>后续内容 <a href="/next">下一篇</a></p><table><thead><tr><th>列</th></tr></thead><tbody><tr><td>值</td></tr></tbody></table><img src="/cover.png" alt="封面"><script>evil()</script>',
  },
  rewrite: { body: '## 改写小节\n\n段落与 **重点**。' },
  translation: null, fetchedAt: 1,
};

describe('article Markdown export', () => {
  it('keeps content scope in new exports without calling the feed fallback an original article', () => {
    const item: Bundle = { ...bundle, entry: { ...bundle.entry, origin: 'local', link: 'https://example.org/feed',
      contentProvenance: { source: 'rss-description', truncated: true, originalLink: false } } };
    const markdown = articleExportMarkdown(item, 'original', articleExportBody(item, 'original', document, false))!;
    expect(markdown).toContain(t('material.feed-description'));
    expect(markdown).toContain(t('material.truncated'));
    expect(markdown).not.toContain('https://example.org/feed');
    expect(markdown).toContain('重要结论');
    const rewritten = articleExportMarkdown(item, 'rewrite', articleExportBody(item, 'rewrite', document, false))!;
    expect(rewritten).toContain(t('material.rewrite'));
    expect(rewritten).not.toContain(t('material.truncated'));
  });

  it('preserves displayed structure, safe links, image references and Chinese-adjacent emphasis', () => {
    const body = articleExportBody(bundle, 'original', document, true);
    const markdown = articleExportMarkdown(bundle, 'original', body)!;
    const rendered = marked.parse(markdown, { async: false });
    expect(markdown).toContain('https://example.com/next');
    expect(markdown).toContain('https://example.com/cover.png');
    expect(markdown).toContain('| 列 |');
    expect(rendered).toContain('<strong>重要结论。</strong>');
    expect(rendered).toContain('后续内容');
    expect(rendered).not.toContain('evil()');
    expect(articleExportMarkdown(bundle, 'original', articleExportBody(bundle, 'original', document, false))).not.toContain('cover.png');
  });

  it('exports the selected reading version and leaves an existing vault Markdown source intact', () => {
    const rewritten = articleExportMarkdown(bundle, 'rewrite', articleExportBody(bundle, 'rewrite', document, true))!;
    expect(rewritten).toContain('## 改写小节');
    expect(rewritten).not.toContain('重要结论');
    const local = { ...bundle, entry: { ...bundle.entry, origin: 'vault' as const, markdown: '---\ntags: [a]\n---\n\n# 原有标题\n' } };
    expect(articleExportMarkdown(local, 'original', null)).toBe(local.entry.markdown);
    expect(articleExportMarkdown({ ...bundle, rewrite: null }, 'rewrite', articleExportBody({ ...bundle, rewrite: null }, 'rewrite', document, true))).toBeNull();
  });
});

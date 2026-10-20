import { describe, expect, it } from 'vitest';
import { t } from '../src/i18n';
import { materialStatus, materialStatusText, paperReadingLinks, sourceArticleUrl } from '../src/material-status';
import type { Bundle, ContentProvenance, Entry } from '../src/model';

function entry(fields: Partial<Entry> = {}): Entry {
  return { id: 'paper', sourceId: 'local:feed', origin: 'local', title: 'A paper', content: '<p>Source material.</p>', ...fields };
}
function bundle(fields: Partial<Entry> = {}, rest: Partial<Omit<Bundle, 'entry'>> = {}): Bundle {
  return { entry: entry(fields), rewrite: null, translation: null, fetchedAt: 1, ...rest };
}
const provenance = (source: ContentProvenance['source'], fields: Partial<ContentProvenance> = {}): ContentProvenance => ({ source, truncated: false, originalLink: true, ...fields });

describe('observed reading material', () => {
  it.each([
    ['rss-content', 'feed-content'], ['atom-content', 'feed-content'],
    ['rss-description', 'feed-description'], ['atom-summary', 'feed-summary'],
  ] as const)('describes %s without calling it verified full text', (source, kind) => {
    expect(materialStatus(bundle({ contentProvenance: provenance(source) }), 'original')).toEqual({ kind, truncated: false });
    expect(materialStatus(bundle({ contentProvenance: provenance(source, { truncated: true }) }), 'original')).toEqual({ kind, truncated: true });
  });

  it('keeps old cached content unknown and does not guess from length or summary equality', () => {
    expect(materialStatus(bundle(), 'original')).toEqual({ kind: 'unknown', truncated: false });
    expect(materialStatus(bundle({ content: 'Long source text. '.repeat(10_000) }), 'original').kind).toBe('unknown');
    expect(materialStatus(bundle({ content: 'Short abstract', summary: 'Short abstract' }), 'original').kind).toBe('unknown');
  });

  it('uses explicit empty provenance despite a localized placeholder body', () => {
    expect(materialStatus(bundle({ content: 'This feed provides no article text.', contentProvenance: provenance('empty') }), 'original')).toEqual({ kind: 'empty', truncated: false });
  });

  it.each([undefined, null, '', ' \n\t '])('treats absent or blank original content as empty: %s', content => {
    expect(materialStatus(bundle({ content }), 'original')).toEqual({ kind: 'empty', truncated: false });
    expect(materialStatus(bundle({ content, contentProvenance: provenance('rss-content') }), 'original').kind).toBe('empty');
  });

  it('follows the actual vault Markdown branch before reading modes', () => {
    const article = bundle({ origin: 'vault', markdown: '', contentProvenance: provenance('rss-content', { truncated: true }) });
    for (const mode of ['original', 'rewrite', 'translation'] as const) expect(materialStatus(article, mode)).toEqual({ kind: 'vault', truncated: false });
    expect(materialStatus(bundle({ origin: 'vault', markdown: null }), 'original')).toEqual({ kind: 'unknown', truncated: false });
  });

  it('describes only an available rewrite and does not inherit original truncation', () => {
    const fields = { contentProvenance: provenance('rss-description', { truncated: true }) };
    expect(materialStatus(bundle(fields, { rewrite: { body: 'Rewritten material.' } }), 'rewrite')).toEqual({ kind: 'rewrite', truncated: false });
    expect(materialStatus(bundle(fields), 'rewrite')).toEqual({ kind: 'empty', truncated: false });
    expect(materialStatus(bundle(fields, { rewrite: { body: ' \n ' } }), 'rewrite').kind).toBe('empty');
  });

  it('requires readable translation targets rather than a translation object or source text', () => {
    const fields = { contentProvenance: provenance('rss-content', { truncated: true }) };
    expect(materialStatus(bundle(fields, { translation: { content: [{ source: 'Original only' }] } }), 'translation')).toEqual({ kind: 'empty', truncated: false });
    expect(materialStatus(bundle(fields, { translation: { content: [] } }), 'translation').kind).toBe('empty');
    expect(materialStatus(bundle(fields, { translation: { content: [{ target: ' \n ', targetHtml: '  ' }] } }), 'translation').kind).toBe('empty');
    expect(materialStatus(bundle(fields, { translation: { content: [{ target: 'Translated text' }] } }), 'translation')).toEqual({ kind: 'translation', truncated: false });
    expect(materialStatus(bundle(fields, { translation: { content: [{ targetHtml: '<p>Translated HTML</p>' }] } }), 'translation').kind).toBe('translation');
    expect(materialStatus(bundle(fields), 'translation').kind).toBe('empty');
  });

  it('uses one localized label and appends truncation only for the displayed original', () => {
    const article = bundle({ contentProvenance: provenance('atom-summary', { truncated: true }) }, { rewrite: { body: 'A rewrite' } });
    expect(materialStatusText(article, 'original')).toBe(`${t('material.feed-summary')} · ${t('material.truncated')}`);
    expect(materialStatusText(article, 'rewrite')).toBe(t('material.rewrite'));
  });
});

describe('source article destinations', () => {
  it('hides a local feed URL fallback while retaining an explicit article link', () => {
    const fields = { link: 'https://example.org/feed.xml', contentProvenance: provenance('rss-content', { originalLink: false }) };
    expect(sourceArticleUrl(entry(fields))).toBeNull();
    expect(sourceArticleUrl(entry({ ...fields, contentProvenance: provenance('rss-content') }))).toBe(fields.link);
    expect(sourceArticleUrl(entry({ link: 'https://example.org/old-article' }))).toBe('https://example.org/old-article');
    expect(sourceArticleUrl(entry({ ...fields, origin: 'qiaomu' }))).toBe(fields.link);
  });

  it.each([undefined, null, '', 'not a URL', '/relative/path', 'javascript:alert(1)', 'data:text/html,x', 'obsidian://open', 'https://user:secret@example.org/article'])('rejects an absent or unsafe source URL: %s', link => {
    expect(sourceArticleUrl(entry({ link }))).toBeNull();
  });

  it('uses the existing safe HTTP(S) URL normalization', () => {
    expect(sourceArticleUrl(entry({ link: 'HTTP://EXAMPLE.ORG' }))).toBe('http://example.org/');
  });
});

describe('explicit paper reading links', () => {
  it.each([
    'https://arxiv.org/abs/2601.12345v2?utm_source=rss#part',
    'https://export.arxiv.org/pdf/2601.12345v3.pdf',
    'https://doi.org/10.48550/arXiv.2601.12345v4',
  ])('offers canonical paper and PDF destinations for one arXiv paper: %s', link => {
    expect(paperReadingLinks(entry({ link }))).toEqual([
      { kind: 'paper', url: 'https://arxiv.org/abs/2601.12345' },
      { kind: 'pdf', url: 'https://arxiv.org/pdf/2601.12345' },
    ]);
  });

  it('preserves old arXiv categories and removes version suffixes', () => {
    expect(paperReadingLinks(entry({ link: 'http://www.arxiv.org/pdf/math.GT/0309136v2.pdf' }))).toEqual([
      { kind: 'paper', url: 'https://arxiv.org/abs/math.gt/0309136' },
      { kind: 'pdf', url: 'https://arxiv.org/pdf/math.gt/0309136' },
    ]);
  });

  it('offers a canonical DOI landing page without inventing a PDF URL', () => {
    expect(paperReadingLinks(entry({ link: 'http://dx.doi.org/10.1000/EXample%2FPart?utm_source=rss#x' }))).toEqual([
      { kind: 'paper', url: 'https://doi.org/10.1000/example/part' },
    ]);
  });

  it('deduplicates the same paper across the entry link, content and summary', () => {
    expect(paperReadingLinks(entry({ link: 'https://arxiv.org/abs/2601.12345', content: '<a href="https://arxiv.org/pdf/2601.12345v2.pdf">Paper</a>', summary: 'https://doi.org/10.48550/arXiv.2601.12345' }))).toHaveLength(2);
  });

  it('rejects an article with multiple explicit papers and does not infer a DOI/arXiv match', () => {
    expect(paperReadingLinks(entry({ link: 'https://arxiv.org/abs/2601.12345', content: 'https://arxiv.org/abs/2602.12345' }))).toEqual([]);
    expect(paperReadingLinks(entry({ link: 'https://arxiv.org/abs/2601.12345', summary: 'https://doi.org/10.1000/publication' }))).toEqual([]);
  });

  it('ignores title-only identifiers, unsafe/lookalike URLs and links beyond the bounded scan', () => {
    expect(paperReadingLinks(entry({ title: 'https://arxiv.org/abs/2601.12345' }))).toEqual([]);
    expect(paperReadingLinks(entry({ link: 'https://arxiv.org.evil.example/abs/2601.12345' }))).toEqual([]);
    expect(paperReadingLinks(entry({ link: 'javascript:https://arxiv.org/abs/2601.12345' }))).toEqual([]);
    expect(paperReadingLinks(entry({ link: 'https://arxiv.org/abs/2601.12345', content: 'x'.repeat(80_001) }))).toEqual([]);
  });
});

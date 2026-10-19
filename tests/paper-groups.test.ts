import { describe, expect, it } from 'vitest';
import { extractPaperReferences, groupPaperEntries } from '../src/paper-groups';
import type { Entry } from '../src/model';

const paper = '2601.12345';
function article(id: string, fields: Partial<Entry> = {}): Entry {
  return { id, sourceId: `source:${id}`, origin: 'local', title: id, ...fields };
}
const keys = (fields: Partial<Entry>) => extractPaperReferences(article('a', fields)).map(reference => reference.key);

describe('explicit paper references', () => {
  it.each([
    `https://arxiv.org/abs/${paper}v2?utm_source=rss#section`,
    `http://www.arxiv.org/pdf/${paper}v3.pdf`,
    `https://arxiv.org/html/${paper}v4/`,
    `https://export.arxiv.org/abs/${paper}`,
    `https://doi.org/10.48550/arXiv.${paper}v2`,
  ])('normalizes modern arXiv links: %s', link => {
    expect(extractPaperReferences(article('a', { link }))).toEqual([
      { key: `arxiv:${paper}`, kind: 'arxiv', id: paper, url: `https://arxiv.org/abs/${paper}` },
    ]);
  });

  it.each(['hep-th/9901001', 'math.GT/0309136'])('normalizes old arXiv identifiers: %s', id => {
    expect(keys({ link: `https://arxiv.org/pdf/${id}v2.pdf` })).toEqual([`arxiv:${id.toLowerCase()}`]);
  });

  it('normalizes DOI case, one layer of path encoding and URL tracking', () => {
    const references = extractPaperReferences(article('a', {
      link: 'https://doi.org/10.1000/EXample%2FPart?utm_source=rss#one',
      content: '<a href="http://dx.doi.org/10.1000/example/part?x=2">Paper</a>',
    }));
    expect(references).toEqual([
      { kind: 'doi', key: 'doi:10.1000/example/part', id: '10.1000/example/part', url: 'https://doi.org/10.1000/example/part' },
    ]);
    expect(keys({ link: 'https://doi.org/10.1000%252Fexample' })).toEqual([]);
    expect(keys({ link: 'https://doi.org/10.1000/%E0%A4%A' })).toEqual([]);
  });

  it('extracts anchor hrefs and literal links, including encoded hrefs and balanced DOI parentheses', () => {
    expect(keys({
      content: `<a title='link > label' href='https:&#47;&#47;arxiv.org/abs/${paper}v2?x=1&amp;y=2'>Paper</a>`,
      summary: `[DOI](https://doi.org/10.1000/ABC(DEF)).`,
    })).toEqual([`arxiv:${paper}`, 'doi:10.1000/abc(def)']);
    expect(keys({ summary: `<https://arxiv.org/abs/${paper}>` })).toEqual([`arxiv:${paper}`]);
  });

  it('does not inspect image src, metadata, data-href, comments or script-like content', () => {
    expect(keys({ content: `
      <img src="https://arxiv.org/abs/${paper}" alt="https://doi.org/10.1000/hidden">
      <a data-href="https://arxiv.org/abs/${paper}" title='href="https://doi.org/10.1000/hidden"'>No link</a>
      <!-- https://arxiv.org/abs/${paper} -->
      <script>const x = "https://arxiv.org/abs/${paper}";</script>
      <style>url(https://arxiv.org/abs/${paper})</style>
      <template><a href="https://arxiv.org/abs/${paper}">Hidden</a></template>
      <noscript>https://arxiv.org/abs/${paper}</noscript>
    ` })).toEqual([]);
  });

  it.each([
    `https://arxiv.org.evil.test/abs/${paper}`,
    `https://user:secret@arxiv.org/abs/${paper}`,
    `https://arxiv.org:8443/abs/${paper}`,
    `ftp://arxiv.org/abs/${paper}`,
    `https://doi.org.evil.test/10.1000/example`,
    `https://doi.org/?url=https://arxiv.org/abs/${paper}`,
    `https://example.com/?paper=https://arxiv.org/abs/${paper}`,
    `https://arxiv.org/search/?query=https://doi.org/10.1000/example`,
    'https://arxiv.org/abs/2613.12345',
    'https://doi.org/10.1000/',
  ])('rejects lookalikes, unexpected origins and nested query links: %s', link => {
    expect(keys({ link, content: `<a href="${link}">Source</a>` })).toEqual([]);
  });

  it('does not infer references from titles or generated content', () => {
    expect(keys({ title: `https://arxiv.org/abs/${paper}`, titleZh: paper,
      summaryZh: `https://doi.org/10.1000/generated`, rewrite: { body: `https://arxiv.org/abs/${paper}` } })).toEqual([]);
  });

  it('deduplicates repeated links but retains different paper identifiers', () => {
    expect(keys({ link: `https://arxiv.org/abs/${paper}`, content: `
      https://arxiv.org/pdf/${paper}v2.pdf https://doi.org/10.48550/arXiv.${paper}
      https://doi.org/10.1000/publication https://arxiv.org/abs/2602.12345
    ` })).toEqual([`arxiv:${paper}`, 'doi:10.1000/publication', 'arxiv:2602.12345']);
  });

  it('fails closed at text and link bounds so an unscanned second paper cannot cause a merge', () => {
    const first = `https://arxiv.org/abs/${paper}`;
    expect(keys({ link: first, content: '中'.repeat(26_667) })).toEqual([]);
    expect(keys({ link: first, content: 'a'.repeat(79_990), summary: 'b'.repeat(11) })).toEqual([]);
    expect(keys({ link: first, content: '<a href="https://example.org/">Other</a>'.repeat(100) })).toEqual([]);
    expect(keys({ link: first, content: '<a href="https://example.org/">Other</a>'.repeat(99) })).toEqual([`arxiv:${paper}`]);
  });
});

describe('paper display groups', () => {
  it('groups all versions and sources while preserving original objects and input order within each group', () => {
    const a = article('a', { link: `https://arxiv.org/abs/${paper}` });
    const other = article('other');
    const b = article('b', { content: `<a href="https://arxiv.org/pdf/${paper}v2.pdf">Paper</a>` });
    const c = article('c', { link: `https://doi.org/10.48550/arXiv.${paper}` });
    const entries = Object.freeze([Object.freeze(a), Object.freeze(other), Object.freeze(b), Object.freeze(c)]);
    const before = JSON.stringify(entries);

    const rows = groupPaperEntries(entries);

    expect(rows).toEqual([
      { kind: 'paper', paper: { key: `arxiv:${paper}`, id: paper, kind: 'arxiv', url: `https://arxiv.org/abs/${paper}` }, entries: [a, b, c] },
      { kind: 'article', entry: other },
    ]);
    expect(rows[0].kind === 'paper' && rows[0].entries[0]).toBe(a);
    expect(rows[0].kind === 'paper' && rows[0].entries[1]).toBe(b);
    expect(JSON.stringify(entries)).toBe(before);
  });

  it('leaves multi-paper articles separate rather than linking unrelated paper groups', () => {
    const a = article('a', { link: `https://arxiv.org/abs/${paper}` });
    const overview = article('overview', { content: `https://arxiv.org/abs/${paper} https://arxiv.org/abs/2602.12345` });
    const b = article('b', { link: 'https://arxiv.org/abs/2602.12345' });
    expect(groupPaperEntries([a, overview, b])).toEqual([
      { kind: 'article', entry: a }, { kind: 'article', entry: overview }, { kind: 'article', entry: b },
    ]);
  });

  it('does not infer a publication DOI match or group identical titles without paper links', () => {
    const entries = [article('a', { title: 'Same title', link: `https://arxiv.org/abs/${paper}` }),
      article('b', { title: 'Same title', link: 'https://doi.org/10.1000/publication' }),
      article('c', { title: 'Same title' })];
    expect(groupPaperEntries(entries)).toEqual(entries.map(entry => ({ kind: 'article', entry })));
  });

  it('preserves every original record, including multiple entries from one source', () => {
    const entries = [article('a', { sourceId: 'same', link: `https://arxiv.org/abs/${paper}` }),
      article('b', { sourceId: 'same', link: `https://arxiv.org/abs/${paper}v2` })];
    const rows = groupPaperEntries(entries);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind === 'paper' && rows[0].entries).toEqual(entries);
    expect(groupPaperEntries([])).toEqual([]);
  });
});

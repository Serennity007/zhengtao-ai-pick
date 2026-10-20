// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { t } from '../src/i18n';
import { renderMaterialInfo } from '../src/material-info';
import type { Bundle, Entry } from '../src/model';

type ElementOptions = { cls?: string; text?: string; attr?: Record<string, string> };
beforeAll(() => {
  Object.assign(HTMLElement.prototype, {
    createEl(this: HTMLElement, tag: string, options: ElementOptions = {}) {
      const element = this.ownerDocument.createElement(tag);
      if (options.cls) element.className = options.cls;
      if (options.text !== undefined) element.textContent = options.text;
      for (const [name, value] of Object.entries(options.attr ?? {})) element.setAttribute(name, value);
      this.append(element); return element;
    },
    createDiv(this: HTMLElement, options: string | ElementOptions = {}) { return this.createEl('div', typeof options === 'string' ? { cls: options } : options); },
    createSpan(this: HTMLElement, options: string | ElementOptions = {}) { return this.createEl('span', typeof options === 'string' ? { cls: options } : options); },
  });
});
afterEach(() => document.body.replaceChildren());

type Provenance = { source: 'rss-content' | 'rss-description' | 'atom-content' | 'atom-summary' | 'empty'; truncated: boolean; originalLink: boolean };
function bundle(fields: Partial<Entry & { contentProvenance?: Provenance }> = {}, rest: Partial<Omit<Bundle, 'entry'>> = {}): Bundle {
  return { entry: { id: 'article', sourceId: 'local:feed', origin: 'local', title: 'Reading article', content: '<p>Article material.</p>', ...fields }, rewrite: null, translation: null, fetchedAt: 1, ...rest };
}
function articleHost() {
  const article = document.createElement('article');
  const title = document.createElement('h1'); title.textContent = 'Reading article'; article.append(title);
  document.body.append(article); return article;
}
const links = (article: HTMLElement) => [...article.querySelectorAll<HTMLAnchorElement>('.qrs-material-info a')];

describe('reading material information panel', () => {
  it('shows observed material scope below the title with safe original, paper and PDF links', () => {
    const article = articleHost();
    renderMaterialInfo(article, bundle({
      link: 'https://example.org/research', content: '<p>Read <a href="https://arxiv.org/abs/2601.12345v2">the paper</a>.</p>',
      contentProvenance: { source: 'rss-description', truncated: true, originalLink: true },
    }), 'original');
    expect(article.children[1].className).toBe('qrs-material-info');
    expect(article.querySelector('.qrs-material-label')?.textContent).toBe(t('material.label'));
    expect(article.querySelector('.qrs-material-scope')?.textContent).toBe(`${t('material.feed-description')} · ${t('material.truncated')}`);
    expect(links(article).map(link => [link.textContent, link.getAttribute('href')])).toEqual([
      [t('material.openOriginal'), 'https://example.org/research'],
      [t('material.paper'), 'https://arxiv.org/abs/2601.12345'],
      [t('material.pdf'), 'https://arxiv.org/pdf/2601.12345'],
    ]);
    for (const link of links(article)) {
      expect(link.target).toBe('_blank'); expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
    expect(article.querySelector('iframe, embed, object, img, script')).toBeNull();
  });

  it('shows one paper page link when the original already is that canonical arXiv page', () => {
    const article = articleHost(); renderMaterialInfo(article, bundle({ link: 'https://arxiv.org/abs/2601.12345' }), 'original');
    expect(links(article).map(link => link.textContent)).toEqual([t('material.paper'), t('material.pdf')]);
    expect(links(article).filter(link => link.href === 'https://arxiv.org/abs/2601.12345')).toHaveLength(1);
  });

  it('does not duplicate a canonical DOI page or a direct arXiv PDF', () => {
    const doi = articleHost(); renderMaterialInfo(doi, bundle({ link: 'https://doi.org/10.1000/test' }), 'original');
    expect(links(doi).map(link => [link.textContent, link.href])).toEqual([[t('material.paper'), 'https://doi.org/10.1000/test']]);
    const pdf = articleHost(); renderMaterialInfo(pdf, bundle({ link: 'https://arxiv.org/pdf/2601.12345' }), 'original');
    expect(links(pdf).map(link => link.textContent)).toEqual([t('material.paper'), t('material.pdf')]);
    expect(links(pdf).filter(link => link.href === 'https://arxiv.org/pdf/2601.12345')).toHaveLength(1);
  });

  it('keeps the WeChat notice with a single original action, alongside an explicitly cited paper', () => {
    const article = articleHost(), url = 'https://mp.weixin.qq.com/s?__biz=account&mid=123&idx=1';
    renderMaterialInfo(article, bundle({ link: url, content: '<a href="https://arxiv.org/abs/2601.12345">Paper</a>' }), 'original');
    expect(article.querySelector('.qrs-material-copyright')?.textContent).toBe(t('reader.wechatNotice'));
    expect(links(article).filter(link => link.href === url)).toHaveLength(1);
    expect(links(article).filter(link => link.textContent === t('material.openOriginal'))).toHaveLength(1);
    expect(links(article)).toHaveLength(3);
    expect(article.querySelector('.qrs-wechat-source')).toBeNull();
  });

  it.each([undefined, 'javascript:alert(1)', 'data:text/html,unsafe', 'https://user:password@example.org/article'])('does not invent an original or paper destination for %s', link => {
    const article = articleHost(); renderMaterialInfo(article, bundle({ link }), 'original');
    expect(article.querySelector('.qrs-material-info')).not.toBeNull();
    expect(article.querySelector('.qrs-material-scope')?.textContent).toBe(t('material.unknown'));
    expect(links(article)).toHaveLength(0); expect(article.querySelector('.qrs-material-links')).toBeNull();
  });

  it('does not present a fallback RSS URL as the original article', () => {
    const article = articleHost(); renderMaterialInfo(article, bundle({
      link: 'https://example.org/feed.xml', contentProvenance: { source: 'rss-content', truncated: false, originalLink: false },
    }), 'original');
    expect(links(article)).toHaveLength(0);
    expect(article.querySelector('.qrs-material-scope')?.textContent).toBe(t('material.feed-content'));
  });

  it('does not choose a paper or generate a PDF when an article cites multiple papers', () => {
    const article = articleHost(); renderMaterialInfo(article, bundle({
      link: 'https://example.org/review', content: 'https://arxiv.org/abs/2601.12345 https://arxiv.org/abs/2602.12345',
    }), 'original');
    expect(links(article).map(link => link.textContent)).toEqual([t('material.openOriginal')]);
  });

  it('labels the selected rewrite and translation on distinct article renders without stale original scope', () => {
    const source = bundle({ contentProvenance: { source: 'rss-content', truncated: true, originalLink: true } }, {
      rewrite: { body: 'Existing rewrite' }, translation: { content: [{ target: 'Existing translation' }] },
    });
    const original = articleHost(), rewrite = articleHost(), translation = articleHost();
    renderMaterialInfo(original, source, 'original'); renderMaterialInfo(rewrite, source, 'rewrite'); renderMaterialInfo(translation, source, 'translation');
    expect(original.querySelector('.qrs-material-scope')?.textContent).toBe(`${t('material.feed-content')} · ${t('material.truncated')}`);
    expect(rewrite.querySelector('.qrs-material-scope')?.textContent).toBe(t('material.rewrite'));
    expect(translation.querySelector('.qrs-material-scope')?.textContent).toBe(t('material.translation'));
    for (const host of [rewrite, translation]) expect(host.textContent).not.toContain(t('material.truncated'));
  });

  it('renders no material panel or action while article content is still loading', () => {
    const article = articleHost(); renderMaterialInfo(article, bundle({ link: 'https://arxiv.org/abs/2601.12345' }), 'original', true);
    expect(article.children).toHaveLength(1); expect(article.querySelector('.qrs-material-info')).toBeNull();
    expect(article.querySelector('a')).toBeNull();
  });
});

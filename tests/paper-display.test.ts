// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', async original => ({
  ...await original<object>(),
  Component: class {}, ItemView: class {}, Modal: class {}, FuzzySuggestModal: class {},
  Plugin: class {}, PluginSettingTab: class {}, MarkdownView: class {}, TFile: class {},
  Notice: vi.fn(class { hide = vi.fn(); }),
  Platform: { isDesktopApp: false, isMobileApp: false },
}));

import { ReaderView } from '../src/view';
import { initialState, type Bundle, type Entry } from '../src/model';

type ElementOptions = { cls?: string; text?: string; type?: string; value?: string; attr?: Record<string, string> };
beforeAll(() => {
  Object.assign(HTMLElement.prototype, {
    addClass(...names: string[]) { this.classList.add(...names); },
    removeClass(...names: string[]) { this.classList.remove(...names); },
    toggleClass(name: string, value: boolean) { this.classList.toggle(name, value); },
    setText(text: string) { this.textContent = text; },
    empty() { this.replaceChildren(); },
    createEl(tag: string, options: ElementOptions = {}) {
      const element = document.createElement(tag);
      if (options.cls) element.className = options.cls;
      if (options.text) element.textContent = options.text;
      if (options.type) element.setAttribute('type', options.type);
      if (options.value !== undefined) element.setAttribute('value', options.value);
      for (const [name, value] of Object.entries(options.attr ?? {})) element.setAttribute(name, value);
      this.append(element); return element;
    },
    createDiv(options: string | ElementOptions = {}) { return this.createEl('div', typeof options === 'string' ? { cls: options } : options); },
    createSpan(options: string | ElementOptions = {}) { return this.createEl('span', typeof options === 'string' ? { cls: options } : options); },
  });
});
afterEach(() => { document.body.replaceChildren(); vi.clearAllMocks(); });

const a: Entry = {
  id: 'local:a:paper', sourceId: 'local:a', origin: 'local', title: '甲方解析：Agent Memory 实验',
  link: 'https://arxiv.org/abs/2601.12345v1', publishedTs: 3000, summary: 'A 的独立解读', content: '<p>A 的正文</p>',
};
const middle: Entry = {
  id: 'local:a:other', sourceId: 'local:a', origin: 'local', title: '其他研究新闻',
  link: 'https://example.org/news', publishedTs: 2000,
};
const b: Entry = {
  id: 'local:b:paper', sourceId: 'local:b', origin: 'local', title: '乙方解析：Agent Memory 局限',
  link: 'https://arxiv.org/pdf/2601.12345v2.pdf', publishedTs: 1000, summary: 'B 的独立解读', content: '<p>B 的正文</p>',
};
const bundle = (entry: Entry): Bundle => ({ entry, rewrite: null, translation: null, fetchedAt: 1 });

// Retain production filtering, grouping, article opening, checkpoints, and keyboard navigation.
// Only Obsidian host services and the unrelated article-body renderer are replaced.
function reader() {
  const state = initialState({ subscriptions: [
    { id: 'local:a', url: 'https://a.example.org/rss', name: '公众号甲', entries: [a, middle] },
    { id: 'local:b', url: 'https://b.example.org/rss', name: '公众号乙', entries: [b] },
  ] });
  const plugin = {
    state, persist: vi.fn(async () => {}), articleDeleted: () => false,
    remember: vi.fn((loaded: Bundle) => { state.cache[loaded.entry.id] = loaded; }),
  };
  const contentEl = document.createElement('div'), list = document.createElement('div'), body = document.createElement('div');
  contentEl.append(list, body); document.body.append(contentEl);
  const view = Object.assign(Object.create(ReaderView.prototype), {
    plugin, contentEl, list, reader: body,
    entries: [a, middle, b], source: '@local', filter: 'all', platform: 'all', query: '',
    bundle: null, mode: 'original', loading: false, closed: false,
    cursor: '', hasMore: false, personalLimit: 100, paperGroupsOpen: new Set<string>(),
    unreadSession: new Set<string>(), lastListTop: 0, lastReaderTop: 0, articleVersion: 0,
    renderReader: vi.fn(), renderThumbnail: vi.fn(),
  });
  contentEl.onkeydown = (event: KeyboardEvent) => view.onReaderKey(event);
  return { view, state, plugin, list, contentEl };
}
const rows = (list: HTMLElement) => [...list.querySelectorAll<HTMLButtonElement>('button[data-entry-id]')];
function row(list: HTMLElement, id: string) { return rows(list).find(item => item.dataset.entryId === id)!; }

describe('paper groups in the reader', () => {
  it('shows one collapsed paper group with every original article button and source, without changing stored entries', () => {
    const { view, state, list } = reader(), before = JSON.stringify(state);
    const originalEntries = [...view.entries]; view.renderList();
    const groups = list.querySelectorAll<HTMLDetailsElement>('details.qrs-paper-group');
    expect(groups).toHaveLength(1); expect(groups[0].open).toBe(false);
    expect(groups[0].querySelector('summary')!.textContent).toContain('2 篇文章');
    expect([...groups[0].querySelectorAll<HTMLButtonElement>('button[data-entry-id]')].map(item => item.dataset.entryId)).toEqual([a.id, b.id]);
    expect(row(list, a.id).textContent).toContain('公众号甲'); expect(row(list, b.id).textContent).toContain('公众号乙');
    expect(row(list, a.id).textContent).toContain(a.title); expect(row(list, b.id).textContent).toContain(b.title);
    expect(rows(list)).toHaveLength(3);
    expect(view.entries).toEqual(originalEntries); expect(view.entries[0]).toBe(a); expect(view.entries[2]).toBe(b);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('opens each original article and keeps read status independent between two interpretations of the same paper', async () => {
    const { view, state, list } = reader(); const open = vi.spyOn(view, 'openArticle'); view.renderList();
    row(list, a.id).click();
    await vi.waitFor(() => expect(view.bundle?.entry).toBe(a));
    expect(open).toHaveBeenLastCalledWith(a); expect(state.readIds).toEqual([a.id]);
    expect(row(list, a.id).classList.contains('qrs-read')).toBe(true);
    expect(row(list, b.id).classList.contains('qrs-read')).toBe(false);
    row(list, b.id).click();
    await vi.waitFor(() => expect(view.bundle?.entry).toBe(b));
    expect(open).toHaveBeenLastCalledWith(b); expect(state.readIds).toEqual([a.id, b.id]);
    expect(state.cache[a.id].entry).toBe(a); expect(state.cache[b.id].entry).toBe(b);
  });

  it('applies unread and query filters before grouping, so a hidden interpretation does not leak into a paper group', () => {
    const { view, state, list } = reader(); state.readIds = [a.id]; view.filter = 'unread'; view.renderList();
    expect(rows(list).map(item => item.dataset.entryId)).toEqual([middle.id, b.id]);
    expect(list.querySelector('details.qrs-paper-group')).toBeNull();
    view.filter = 'all'; view.query = '乙方解析'; view.renderList();
    expect(rows(list).map(item => item.dataset.entryId)).toEqual([b.id]);
    expect(list.querySelector('details.qrs-paper-group')).toBeNull();
    view.query = '其他研究'; view.renderList();
    expect(rows(list).map(item => item.dataset.entryId)).toEqual([middle.id]);
  });

  it('automatically expands the paper containing the current article', () => {
    const { view, list } = reader(); view.bundle = bundle(b); view.renderList();
    expect(list.querySelector<HTMLDetailsElement>('details.qrs-paper-group')!.open).toBe(true);
    expect(row(list, b.id).getAttribute('aria-pressed')).toBe('true');
    expect(row(list, a.id).getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps J/K navigation in the original visible article order even when the grouped DOM order differs', () => {
    const { view, list, contentEl } = reader(); view.renderList();
    expect(rows(list).map(item => item.dataset.entryId)).toEqual([a.id, b.id, middle.id]);
    const press = (key: string) => { const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }); contentEl.dispatchEvent(event); expect(event.defaultPrevented).toBe(true); };
    press('j'); expect(view.bundle?.entry).toBe(a);
    press('j'); expect(view.bundle?.entry).toBe(middle);
    press('j'); expect(view.bundle?.entry).toBe(b);
    press('k'); expect(view.bundle?.entry).toBe(middle);
    expect(view.entries).toEqual([a, middle, b]);
  });
});

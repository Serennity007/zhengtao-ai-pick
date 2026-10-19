// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', async original => ({
  ...await original<object>(),
  Component: class {}, ItemView: class {}, Modal: class {}, FuzzySuggestModal: class {},
  Plugin: class {}, PluginSettingTab: class {}, MarkdownView: class {}, TFile: class {},
  Notice: vi.fn(),
}));

import Plugin from '../src/main';
import { ReaderView } from '../src/view';
import { initialState, type Bundle, type Entry } from '../src/model';

beforeAll(() => {
  Object.assign(HTMLElement.prototype, {
    addClass(name: string) { this.classList.add(name); },
    removeClass(name: string) { this.classList.remove(name); },
    toggleClass(name: string, value: boolean) { this.classList.toggle(name, value); },
  });
});

function snapshot(origin: Entry['origin'] = 'local'): Bundle {
  return {
    entry: { id: 'saved-paper', sourceId: 'local:retired', origin, title: 'Agent memory', content: '<p>Saved body</p>' },
    rewrite: null, translation: null, fetchedAt: 1,
  };
}

function host(source = '@local') {
  const plugin = Object.assign(Object.create(Plugin.prototype) as Plugin, {
    state: initialState({ readIds: ['existing-read'] }), researchWrites: Promise.resolve(),
    persist: vi.fn(async () => {}), openReader: vi.fn(async () => {}), api: vi.fn(),
    articleDeleted: () => false,
  });
  const view = Object.assign(Object.create(ReaderView.prototype), {
    plugin, contentEl: document.createElement('div'), list: document.createElement('div'),
    reader: document.createElement('div'), channelButton: document.createElement('button'),
    entries: [], source, bundle: null, mode: 'original', filter: 'all', query: '',
    cursor: '', hasMore: false, unreadSession: new Set<string>(), closed: false,
    articleVersion: 0, articleLoading: false, lastListTop: 0, lastReaderTop: 0,
    renderReader: vi.fn(), renderList: vi.fn(), renderChannel: vi.fn(), renderFilters: vi.fn(),
  });
  Object.assign(plugin, { app: { workspace: { getLeavesOfType: () => [{ view }] } } });
  return { plugin, view };
}

describe('read-later snapshot lifecycle', () => {
  it.each(['qiaomu', 'vault', undefined] as const)('rejects a %s snapshot before opening a reader or changing personal state', async origin => {
    const { plugin, view } = host();
    const saved = snapshot();
    saved.entry.origin = origin;
    const before = structuredClone(plugin.state);

    await expect(plugin.addReadLater(saved.entry, saved)).rejects.toThrow();
    await expect(plugin.openResearchArticle(saved.entry, saved)).rejects.toThrow();

    expect(plugin.state).toEqual(before);
    expect(plugin.openReader).not.toHaveBeenCalled();
    expect(plugin.api).not.toHaveBeenCalled();
    expect(plugin.persist).not.toHaveBeenCalled();
    expect(view.bundle).toBeNull();
  });

  it.each(['@local', 'local:retired'])('keeps an unsubscribed RSS snapshot visible through library refresh in %s', async source => {
    const { plugin, view } = host(source);
    const saved = snapshot();
    await plugin.addReadLater(saved.entry, saved);
    const key = plugin.readLaterKey(saved.entry);
    const reopened = structuredClone(plugin.state.readLater[key].bundle);
    expect(plugin.state.subscriptions).toEqual([]);

    // A rehydrated snapshot has no object identity relationship with the stored value.
    await plugin.openResearchArticle(reopened.entry, reopened);
    expect(view.bundle).toEqual(reopened);
    expect(plugin.state.readIds).toEqual(['existing-read', reopened.entry.id]);

    view.refreshPersonalSources(['local:retired']);
    expect(view.bundle).toEqual(reopened);
    expect(view.source).toBe(source);
    view.refreshPersonalSources();
    expect(view.bundle?.entry.content).toBe('<p>Saved body</p>');
    expect(plugin.state.readLater[key].bundle).toEqual(saved);
    expect(plugin.api).not.toHaveBeenCalled();
  });

  it('still clears an ordinary unsubscribed RSS article without a read-later key', () => {
    const { plugin, view } = host();
    const saved = snapshot();
    plugin.state.readLater[plugin.readLaterKey(saved.entry)] = { bundle: saved, savedAt: 1 };
    view.showSavedArticle(saved, 'original');

    view.refreshPersonalSources(['local:retired']);

    expect(view.bundle).toBeNull();
    expect(plugin.state.readLater[plugin.readLaterKey(saved.entry)].bundle).toEqual(saved);
  });
});

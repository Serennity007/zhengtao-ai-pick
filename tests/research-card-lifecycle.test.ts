// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', async original => ({
  ...await original<object>(),
  Component: class {}, ItemView: class {}, Modal: class {}, FuzzySuggestModal: class {}, MarkdownView: class {},
  TFile: class { path = ''; },
  Plugin: class {
    constructor(public app: unknown, public manifest: unknown) {}
    register = vi.fn(); registerEvent = vi.fn(); registerView = vi.fn(); registerDomEvent = vi.fn();
    registerMarkdownPostProcessor = vi.fn(); registerObsidianProtocolHandler = vi.fn();
    registerInterval = vi.fn((id: number) => window.clearInterval(id));
    addCommand = vi.fn(); addRibbonIcon = vi.fn(); addSettingTab = vi.fn();
  },
  PluginSettingTab: class { containerEl = document.createElement('div'); },
  Notice: vi.fn(class { hide = vi.fn(); }),
  Platform: { isDesktopApp: false, isMobileApp: false },
}));
vi.mock('../src/vault-export', async original => ({
  ...await original<object>(), saveArticleToVault: vi.fn(),
}));

import { Notice, TFile } from 'obsidian';
import ZhengtaoPicksPlugin from '../src/main';
import { ReaderView } from '../src/view';
import { articleNoteKey, initialState, renameArticleNotes, type Bundle, type State } from '../src/model';
import { saveArticleToVault } from '../src/vault-export';
import { t } from '../src/i18n';
import { PLUGIN_ID } from '../src/identity';

beforeAll(() => {
  Object.assign(HTMLElement.prototype, {
    addClass(...names: string[]) { this.classList.add(...names); },
    removeClass(...names: string[]) { this.classList.remove(...names); },
    toggleClass(name: string, value: boolean) { this.classList.toggle(name, value); },
  });
});
beforeEach(() => {
  vi.stubGlobal('createFragment', (callback: (fragment: DocumentFragment) => void) => {
    const fragment = document.createDocumentFragment();
    Object.assign(fragment, {
      appendText(text: string) { fragment.append(document.createTextNode(text)); },
      createEl(tag: string, options: { text?: string; href?: string }) {
        const element = document.createElement(tag); element.textContent = options.text || '';
        if (options.href) element.setAttribute('href', options.href);
        fragment.append(element); return element;
      },
    });
    callback(fragment); return fragment;
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

const article: Bundle = {
  entry: { id: 'local:source:paper', sourceId: 'local:source', origin: 'local', title: 'Agent memory paper', link: 'https://arxiv.org/abs/2601.12345', content: '<p>Persisted research material</p>' },
  rewrite: null, translation: null, fetchedAt: 10,
};
const cardKey = `research|${articleNoteKey(`local|${article.entry.id}`, 'original')}`;

function host(data: unknown = null) {
  const files = new Map<string, TFile>(), persisted: State[] = [];
  let active: unknown = null;
  const openFile = vi.fn(async () => {});
  const app = {
    vault: {
      configDir: '.obsidian', getName: () => '科研测试库',
      getAbstractFileByPath: (path: string) => files.get(path),
      on: vi.fn(() => ({})), adapter: { exists: vi.fn(async () => false) },
    },
    workspace: {
      on: vi.fn(() => ({})), onLayoutReady: vi.fn(), trigger: vi.fn(),
      getActiveViewOfType: vi.fn(() => active), getLeavesOfType: () => [{ view }],
      getLeaf: vi.fn(() => ({ openFile })),
    },
  };
  const state = initialState(data);
  const plugin = Object.assign(new ZhengtaoPicksPlugin(app as never, { id: PLUGIN_ID } as never), {
    state, loadData: vi.fn(async () => state),
    persist: vi.fn(async () => { persisted.push(structuredClone(plugin.state)); }),
    openReader: vi.fn(async () => {}), api: vi.fn(), syncDeletedArticles: vi.fn(async () => {}),
    researchCardWrites: Promise.resolve(),
  });
  const view = Object.assign(Object.create(ReaderView.prototype), {
    app, plugin, contentEl: document.createElement('div'), list: document.createElement('div'), reader: document.createElement('div'), channelButton: document.createElement('button'),
    entries: [article.entry], source: '@local', bundle: article, mode: 'original', filter: 'all', query: '',
    cursor: '', hasMore: false, unreadSession: new Set<string>(), closed: false,
    articleVersion: 0, articleLoading: false, cardSaving: false, lastListTop: 0, lastReaderTop: 0,
    renderReader: vi.fn(), renderList: vi.fn(), renderChannel: vi.fn(), renderFilters: vi.fn(),
  });
  vi.mocked(saveArticleToVault).mockReset().mockImplementation(async (_app, _bundle, _mode, _doc, _images, _includeImages, folder, research) => {
    const name = research ? 'Research card' : 'Article'; let path = `${folder}/${name}.md`, index = 2;
    while (files.has(path)) path = `${folder}/${name} (${index++}).md`;
    const file = Object.assign(new TFile(), { path });
    files.set(file.path, file); return { file, missingImages: 0 };
  });
  return { plugin, view, files, persisted, openFile, app, setActive: (value: unknown) => { active = value; } };
}

function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe('research card persistence and links', () => {
  it('opens the persisted URI snapshot after restart even when the ordinary article cache is empty', async () => {
    const first = host(), uri = await first.plugin.ensureResearchSnapshot(article, 'original');
    const persisted = structuredClone(first.persisted[0]); persisted.cache = {}; persisted.favorites = {};
    const reopened = host(persisted), url = new URL(uri);
    expect(url.protocol).toBe('obsidian:'); expect(url.hostname).toBe(PLUGIN_ID);
    expect(url.searchParams.get('vault')).toBe('科研测试库');
    await reopened.plugin.openSavedArticle(url.searchParams.get('article')!, url.searchParams.get('mode')!);
    expect(reopened.view.bundle).toEqual(article);
    expect(reopened.view.bundle.entry.content).toBe('<p>Persisted research material</p>');
    expect(reopened.plugin.state.cache).toEqual({}); expect(reopened.plugin.api).not.toHaveBeenCalled();
    expect(saveArticleToVault).not.toHaveBeenCalled();
  });

  it('keeps a card backlink snapshot visible after its RSS source is unsubscribed and the personal library refreshes', async () => {
    const { plugin, view } = host({ subscriptions: [
      { id: article.entry.sourceId, name: 'Research source', url: 'https://example.org/rss', entries: [article.entry] },
    ] });
    const uri = new URL(await plugin.ensureResearchSnapshot(article, 'original'));
    await plugin.openSavedArticle(uri.searchParams.get('article')!, 'original');
    view.source = article.entry.sourceId;
    plugin.state.subscriptions = []; plugin.state.cache = {};

    view.refreshPersonalSources([article.entry.sourceId]);
    view.refreshPersonalSources();

    expect(view.bundle).toEqual(article);
    expect(view.bundle.entry.content).toBe('<p>Persisted research material</p>');
    expect(view.entries).toEqual([]);
    expect(plugin.state.savedArticles[uri.searchParams.get('article')!]).toEqual(article);
    expect(plugin.api).not.toHaveBeenCalled();
  });

  it('protects only the explicitly referenced snapshot store and matching article, not any same-ID saved entry', () => {
    const { plugin, view } = host(), key = plugin.readLaterKey(article.entry);
    plugin.state.readLater[key] = { bundle: article, savedAt: 1 };
    view.showSavedArticle(article, 'original', { store: 'savedArticles', key });
    view.refreshPersonalSources([article.entry.sourceId]);
    expect(view.bundle).toBeNull();

    plugin.state.savedArticles[key] = { ...article, entry: { ...article.entry, id: 'different-article' } };
    view.showSavedArticle(article, 'original', { store: 'savedArticles', key });
    view.refreshPersonalSources([article.entry.sourceId]);
    expect(view.bundle).toBeNull();

    plugin.state.savedArticles[key] = article;
    view.showSavedArticle(article, 'original');
    view.refreshPersonalSources([article.entry.sourceId]);
    expect(view.bundle).toBeNull();
  });

  it.each([false, true])('does not create a file if the snapshot cannot persist, restoring an existing snapshot: %s', async existing => {
    const { plugin, view, files } = host(), key = plugin.readLaterKey(article.entry);
    const previous = { ...article, entry: { ...article.entry, content: '<p>Earlier saved material</p>' } };
    if (existing) plugin.state.savedArticles[key] = previous;
    plugin.persist.mockRejectedValueOnce(new Error('Disk full'));
    await expect(view.saveNoteAt(article, 'original', 'Research', false, true)).rejects.toThrow('Disk full');
    expect(saveArticleToVault).not.toHaveBeenCalled(); expect(files.size).toBe(0);
    expect(plugin.state.articleNotes[cardKey]).toBeUndefined();
    if (existing) expect(plugin.state.savedArticles[key]).toBe(previous);
    else expect(Object.hasOwn(plugin.state.savedArticles, key)).toBe(false);
  });

  it('does not roll back over a newer snapshot written while a failed persist was pending', async () => {
    const { plugin } = host(), pending = deferred(), key = plugin.readLaterKey(article.entry);
    plugin.persist.mockImplementationOnce(() => pending.promise);
    const saving = plugin.ensureResearchSnapshot(article, 'original');
    const newer = { ...article, fetchedAt: 99 }; plugin.state.savedArticles[key] = newer;
    pending.reject(new Error('Transient write failure'));
    await expect(saving).rejects.toThrow('Transient write failure');
    expect(plugin.state.savedArticles[key]).toBe(newer);
  });

  it('retains a created card after settings persistence fails, retries settings only, and opens the existing card on another save command', async () => {
    const { plugin, view, files, openFile } = host();
    plugin.persist.mockRejectedValueOnce(new Error('Snapshot unavailable'));
    // First establish the early failure path through the public save action, then retry normally.
    view.saveCurrentResearchCard();
    await vi.waitFor(() => expect(view.cardSaving).toBe(false));
    expect(saveArticleToVault).not.toHaveBeenCalled();

    plugin.persist.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Settings unavailable'));
    view.saveCurrentResearchCard(); view.saveCurrentResearchCard();
    await vi.waitFor(() => expect(view.cardSaving).toBe(false));
    expect(saveArticleToVault).toHaveBeenCalledTimes(1); expect(files.size).toBe(1);
    const savedPath = plugin.state.articleNotes[cardKey], savedFile = files.get(savedPath)!;
    expect(savedPath).toBe('正涛精选/文章/科研卡片/Research card.md');
    const notices = vi.mocked(Notice).mock.calls.map(([message]) => message).filter((message): message is DocumentFragment => message instanceof DocumentFragment);
    const warning = notices.find(message => message.textContent?.includes(t('note.settingsSaveFailed')))!;
    expect(warning).toBeDefined();
    const retry = [...warning.querySelectorAll('a')].find(link => link.textContent === t('common.retry'))!;
    const previousWrites = plugin.persist.mock.calls.length; retry.click();
    await vi.waitFor(() => expect(plugin.persist).toHaveBeenCalledTimes(previousWrites + 1));
    expect(saveArticleToVault).toHaveBeenCalledTimes(1);
    view.saveCurrentResearchCard();
    await vi.waitFor(() => expect(openFile).toHaveBeenCalledExactlyOnceWith(savedFile));
    expect(saveArticleToVault).toHaveBeenCalledTimes(1);
    expect(plugin.state.savedArticles[plugin.readLaterKey(article.entry)]).toEqual(article);
  });

  it('keeps ordinary article notes and research cards separate and follows renames for both mappings', async () => {
    const { plugin, view } = host();
    await view.saveNoteAt(article, 'original', '阅读材料');
    await view.saveNoteAt(article, 'original', '阅读材料/科研卡片', false, true);
    const ordinaryKey = articleNoteKey(article.entry.id, 'original');
    expect(plugin.state.articleNotes[ordinaryKey]).toBe('阅读材料/Article.md');
    expect(plugin.state.articleNotes[cardKey]).toBe('阅读材料/科研卡片/Research card.md');
    expect(view.savedNote(article, 'original')?.path).toBe('阅读材料/Article.md');
    expect(view.savedResearchCard(article, 'original')?.path).toBe('阅读材料/科研卡片/Research card.md');
    expect(renameArticleNotes(plugin.state.articleNotes, '阅读材料/科研卡片/Research card.md', '阅读材料/科研卡片/自定标题.md')).toBe(true);
    expect(plugin.state.articleNotes[ordinaryKey]).toBe('阅读材料/Article.md');
    expect(renameArticleNotes(plugin.state.articleNotes, '阅读材料', '归档')).toBe(true);
    expect(plugin.state.articleNotes[ordinaryKey]).toBe('归档/Article.md');
    expect(plugin.state.articleNotes[cardKey]).toBe('归档/科研卡片/自定标题.md');
  });

  it('keeps research cards for the same remote entry ID separate across service origins', async () => {
    const { plugin, view, files, openFile } = host();
    const fromA: Bundle = { ...article, entry: { ...article.entry, id: 'same-id', origin: 'qiaomu', sourceId: 'news', title: 'Article from A' } };
    const fromB: Bundle = { ...fromA, entry: { ...fromA.entry, title: 'Different article from B', content: '<p>B material</p>' } };
    plugin.state.settings.baseUrl = 'https://a.example.org'; view.showSavedArticle(fromA, 'original');
    view.saveCurrentResearchCard(); await vi.waitFor(() => expect(view.cardSaving).toBe(false));
    const aKey = `research|${articleNoteKey('https://a.example.org|same-id', 'original')}`;
    const aPath = plugin.state.articleNotes[aKey]; expect(aPath).toBeDefined();
    plugin.state.settings.baseUrl = 'https://b.example.org'; view.showSavedArticle(fromB, 'original');
    view.saveCurrentResearchCard(); await vi.waitFor(() => expect(view.cardSaving).toBe(false));
    const bKey = `research|${articleNoteKey('https://b.example.org|same-id', 'original')}`;
    expect(plugin.state.articleNotes[bKey]).toBeDefined(); expect(plugin.state.articleNotes[bKey]).not.toBe(aPath);
    expect(saveArticleToVault).toHaveBeenCalledTimes(2); expect(files.size).toBe(2); expect(openFile).not.toHaveBeenCalled();
    expect(plugin.state.savedArticles['https://a.example.org|same-id']).toEqual(fromA);
    expect(plugin.state.savedArticles['https://b.example.org|same-id']).toEqual(fromB);
  });

  it('retains the original service identity for a reopened card snapshot and blocks reload against another service', async () => {
    const { plugin, view } = host();
    const remote: Bundle = { ...article, entry: { ...article.entry, id: 'same-id', sourceId: 'news', origin: 'qiaomu' } };
    const identity = 'https://a.example.org|same-id';
    plugin.state.settings.baseUrl = 'https://a.example.org';
    await plugin.ensureResearchSnapshot(remote, 'original');
    plugin.state.settings.baseUrl = 'https://b.example.org';
    await plugin.openSavedArticle(identity, 'original');
    expect(view.canReloadArticle(remote.entry)).toBe(false);
    const open = vi.spyOn(view, 'openArticle'); await view.reloadArticle(remote.entry);
    expect(open).not.toHaveBeenCalled(); expect(plugin.syncDeletedArticles).not.toHaveBeenCalled(); expect(plugin.api).not.toHaveBeenCalled();
    view.saveCurrentResearchCard(); await vi.waitFor(() => expect(view.cardSaving).toBe(false));
    expect(plugin.state.articleNotes[`research|${articleNoteKey(identity, 'original')}`]).toBeDefined();
    expect(plugin.state.articleNotes[`research|${articleNoteKey('https://b.example.org|same-id', 'original')}`]).toBeUndefined();
    const options = vi.mocked(saveArticleToVault).mock.calls[0][7]!;
    expect(new URL(options.backlink).searchParams.get('article')).toBe(identity);
    expect(plugin.state.savedArticles['https://b.example.org|same-id']).toBeUndefined();
    expect(view.bundle).toEqual(remote);
  });

  it.each(['local', 'vault'] as const)('continues to reload a saved %s snapshot through its own source without remote service synchronization', async origin => {
    const { plugin, view } = host();
    const saved: Bundle = { ...article, entry: { ...article.entry, origin, ...(origin === 'vault' ? { markdownPath: 'Research.md', markdown: 'Saved vault material' } : {}) } };
    const identity = plugin.readLaterKey(saved.entry); plugin.state.savedArticles[identity] = saved;
    plugin.state.settings.baseUrl = 'https://b.example.org'; view.showSavedArticle(saved, 'original', { store: 'savedArticles', key: identity });
    const loadVault = vi.spyOn(plugin.vaultSources, 'article').mockResolvedValue(saved);
    expect(view.canReloadArticle(saved.entry)).toBe(true); await view.reloadArticle(saved.entry);
    expect(plugin.syncDeletedArticles).not.toHaveBeenCalled(); expect(plugin.api).not.toHaveBeenCalled();
    expect(view.bundle.entry).toEqual(saved.entry);
    expect(loadVault).toHaveBeenCalledTimes(origin === 'vault' ? 1 : 0);
  });

  it('serializes two reader views for one card, keeping the captured article and origin through queued writes', async () => {
    const { plugin, view, files, openFile, app } = host();
    const remote: Bundle = { ...article, entry: { ...article.entry, id: 'same-id', sourceId: 'news', origin: 'qiaomu' } };
    plugin.state.settings.baseUrl = 'https://a.example.org'; view.bundle = remote;
    const second = Object.assign(Object.create(ReaderView.prototype), view, {
      app, contentEl: document.createElement('div'), list: document.createElement('div'), reader: document.createElement('div'),
      cardSaving: false, renderReader: vi.fn(), renderList: vi.fn(),
    });
    const pending = deferred(), write = vi.mocked(saveArticleToVault).getMockImplementation()!;
    vi.mocked(saveArticleToVault).mockImplementationOnce(async (...args) => { await pending.promise; return write(...args); });
    view.saveCurrentResearchCard(); await vi.waitFor(() => expect(saveArticleToVault).toHaveBeenCalledTimes(1));
    second.saveCurrentResearchCard(); expect(second.cardSaving).toBe(true);
    plugin.state.settings.baseUrl = 'https://b.example.org';
    second.bundle = { ...remote, entry: { ...remote.entry, id: 'switched-article' } };
    await Promise.resolve(); expect(saveArticleToVault).toHaveBeenCalledTimes(1);
    pending.resolve();
    await vi.waitFor(() => { expect(view.cardSaving).toBe(false); expect(second.cardSaving).toBe(false); });
    expect(saveArticleToVault).toHaveBeenCalledTimes(1); expect(files.size).toBe(1);
    const identity = 'https://a.example.org|same-id', path = plugin.state.articleNotes[`research|${articleNoteKey(identity, 'original')}`];
    expect(path).toBeDefined(); expect(openFile).toHaveBeenCalledExactlyOnceWith(files.get(path));
    expect(new URL(vi.mocked(saveArticleToVault).mock.calls[0][7]!.backlink).searchParams.get('article')).toBe(identity);
    expect(plugin.state.savedArticles['https://b.example.org|same-id']).toBeUndefined();
    expect(Object.keys(plugin.state.articleNotes)).toEqual([`research|${articleNoteKey(identity, 'original')}`]);
  });

  it('enables the registered card command only for a loaded article and blocks repeated commands while saving', async () => {
    const fixture = host(), { plugin, view } = fixture;
    await plugin.onload();
    const command = plugin.addCommand.mock.calls.map(([value]) => value).find(value => value.id === 'save-research-card')!;
    expect(command).toBeDefined(); expect(command.checkCallback(true)).toBe(false);
    fixture.setActive(view); view.bundle = null;
    expect(command.checkCallback(true)).toBe(false);
    view.bundle = article; expect(command.checkCallback(true)).toBe(true);
    expect(saveArticleToVault).not.toHaveBeenCalled();
    view.articleLoading = true; expect(command.checkCallback(true)).toBe(false); view.articleLoading = false;
    const pending = deferred(); plugin.persist.mockImplementationOnce(() => pending.promise);
    expect(command.checkCallback(false)).toBe(true);
    expect(view.cardSaving).toBe(true); expect(command.checkCallback(true)).toBe(false);
    expect(command.checkCallback(false)).toBe(false); expect(saveArticleToVault).not.toHaveBeenCalled();
    pending.resolve(); await vi.waitFor(() => expect(view.cardSaving).toBe(false));
    expect(saveArticleToVault).toHaveBeenCalledTimes(1);
  });
});

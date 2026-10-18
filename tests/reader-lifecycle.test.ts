// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', async original => ({
  ...await original<object>(),
  Component: class {}, ItemView: class {}, Modal: class {}, FuzzySuggestModal: class {},
  Plugin: class {}, PluginSettingTab: class {}, MarkdownView: class {}, TFile: class {},
  Notice: vi.fn(class { hide = vi.fn(); }),
  Platform: { isDesktopApp: false, isMobileApp: false },
}));

import Plugin from '../src/main';
import { ReaderView } from '../src/view';
import { initialState, type Bundle, type ChannelState, type Entry, type State } from '../src/model';
import { Subscriptions } from '../src/subscriptions';

beforeAll(() => {
  Object.defineProperty(window.crypto, 'subtle', { value: webcrypto.subtle, configurable: true });
  Object.assign(HTMLElement.prototype, {
    addClass(name: string) { this.classList.add(name); },
    removeClass(name: string) { this.classList.remove(name); },
    toggleClass(name: string, value: boolean) { this.classList.toggle(name, value); },
    setText(text: string) { this.textContent = text; },
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

const entry = (id: string, sourceId = 'local:a', origin: Entry['origin'] = 'local'): Entry => ({ id, sourceId, origin, title: id });
const bundle = (item: Entry): Bundle => ({ entry: item, rewrite: null, translation: null, fetchedAt: 1 });
const checkpoint = (entries: Entry[], opened = entries[0]): ChannelState => ({
  entries, bundle: opened ? bundle(opened) : null, mode: 'original', filter: 'unread', query: 'research',
  unread: entries.map(item => item.id), cursor: 'old-page', hasMore: false, listTop: 48, readerTop: 192, articlePending: false,
});
const key = (state: State, source: string) => JSON.stringify([state.settings.baseUrl, source]);

// Execute production lifecycle methods while replacing only DOM rendering and host services.
function reader(state: State, source = '') {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const plugin = {
    state, persist: vi.fn(async () => {}), collectionAdminAvailable: () => false,
    collectionLocalItems: () => [], articleDeleted: () => false,
    api: vi.fn(), subscriptions: undefined as unknown as Subscriptions,
  };
  const view = Object.assign(Object.create(ReaderView.prototype), {
    plugin, contentEl: document.createElement('div'), list: document.createElement('div'),
    reader: document.createElement('div'), status: document.createElement('div'),
    refreshButton: document.createElement('button'), channelButton: document.createElement('button'),
    searchInput: document.createElement('input'), searchBox: document.createElement('div'),
    entries: [], source, bundle: null, mode: 'rewrite', filter: 'all', query: '',
    cursor: '', hasMore: false, unreadSession: new Set<string>(), closed: false,
    lastListTop: 0, lastReaderTop: 0, listVersion: 0, articleVersion: 0, loading: false, articleLoading: false,
    build: vi.fn(), renderList: vi.fn(), renderReader: vi.fn(), renderFilters: vi.fn(),
    renderChannel: vi.fn(), clearThumbnails: vi.fn(),
  });
  return { view, plugin };
}

describe('personal reader checkpoints', () => {
  it.each(['reset', 'selectSource'] as const)('checks the five-minute feed TTL after %s restores a nonempty group checkpoint', async action => {
    const old = entry('old');
    const state = initialState({ subscriptions: [{ id: 'local:a', url: 'https://example.org/rss', name: 'A', group: 'Research', entries: [old], updatedAt: Date.now() - 300001 }] });
    const source = `@group:${state.sourceMeta['local:a'].groupId}`;
    const saved = state.channelStates[key(state, source)] = checkpoint([old]);
    state.settings.lastSource = source;
    const { view, plugin } = reader(state);
    const transport = vi.fn(async () => ({ status: 200, text: '<rss><channel><title>A</title><item><guid>new</guid><title>Fresh research</title><link>https://example.org/new</link></item></channel></rss>' }));
    plugin.subscriptions = new Subscriptions(() => state, async () => {
      await plugin.persist(); view.refreshPersonalSources();
    }, transport);

    if (action === 'reset') view.reset(); else view.selectSource(source);
    await vi.waitFor(() => { expect(view.loading).toBe(false); expect(transport).toHaveBeenCalledOnce(); });

    expect(view.source).toBe(source); // UUID-based groups survive reset.
    expect(view.entries).toHaveLength(1);
    expect(view.entries[0].title).toBe('Fresh research');
    expect(view.bundle).toBe(saved.bundle);
    expect(view).toMatchObject({ mode: saved.mode, filter: saved.filter, query: saved.query, cursor: saved.cursor });
    expect([...view.unreadSession]).toEqual(saved.unread);
    expect(view.pendingScroll).toEqual({ listTop: 48, readerTop: 192 });
    expect(plugin.api).not.toHaveBeenCalled();
    expect(plugin.persist).toHaveBeenCalledTimes(action === 'reset' ? 1 : 2);
  });

  it('runs the TTL check without requesting a fresh feed or starting a refresh loop', async () => {
    const cached = entry('cached');
    const state = initialState({ subscriptions: [{ id: 'local:a', url: 'https://example.org/rss', name: 'A', entries: [cached], updatedAt: Date.now() }] });
    state.settings.lastSource = 'local:a'; state.channelStates[key(state, 'local:a')] = checkpoint([cached]);
    const { view, plugin } = reader(state);
    const transport = vi.fn();
    plugin.subscriptions = new Subscriptions(() => state, plugin.persist, transport);
    const refresh = vi.spyOn(plugin.subscriptions, 'refresh');
    view.reset();
    await vi.waitFor(() => expect(view.loading).toBe(false));
    expect(refresh).toHaveBeenCalledOnce();
    expect(transport).not.toHaveBeenCalled();
    expect(plugin.persist).not.toHaveBeenCalled();
    expect(view.entries).toEqual([cached]);
  });

  it('keeps nonempty remote channel restoration free of new requests', () => {
    const remote = entry('remote', 'news', 'qiaomu');
    const state = initialState({ sources: [{ id: 'news', name: 'News', category: 'news' }] });
    const { view, plugin } = reader(state);
    state.channelStates[key(state, 'news')] = checkpoint([remote]);
    view.selectSource('news');
    expect(view.entries).toEqual([remote]);
    expect(plugin.api).not.toHaveBeenCalled();
  });

  it('reconciles a stale personal checkpoint with the current feed cache', () => {
    const current = entry('current', 'local:b'), removed = entry('removed');
    const state = initialState({ subscriptions: [{ id: 'local:b', url: 'https://example.org/b', name: 'B', entries: [current] }] });
    const { view } = reader(state, '@local');
    view.restoreChannel(checkpoint([removed]));
    expect(view.entries).toEqual([current]);
    expect(view.bundle).toBeNull();
  });
});

function removalFixture() {
  const removed = entry('removed'), retained = entry('retained', 'local:b');
  const removedBundle = bundle(removed);
  const state = initialState({
    subscriptions: [
      { id: 'local:a', url: 'https://example.org/a', name: 'A', entries: [removed] },
      { id: 'local:b', url: 'https://example.org/b', name: 'B', entries: [retained] },
    ], favorites: { removed: removedBundle }, cache: { removed: removedBundle },
    savedArticles: { removed: removedBundle }, articleNotes: { 'removed|original': 'Saved.md' },
  });
  state.channelStates[key(state, '@local')] = checkpoint([removed, retained]);
  state.channelStates[key(state, 'local:a')] = checkpoint([removed]);
  state.channelStates[JSON.stringify(['https://other.example.org', '@local'])] = checkpoint([removed, retained]);
  state.channelStates[key(state, 'local:b')] = checkpoint([retained]);
  const { view } = reader(state, 'local:a');
  view.entries = [removed]; view.bundle = removedBundle;
  const plugin = Object.assign(Object.create(Plugin.prototype), {
    state, libraryEdits: Promise.resolve(), persist: vi.fn(async () => {}), refreshDiscovery: vi.fn(),
    app: { workspace: { getLeavesOfType: () => [{ view }] } },
  });
  view.plugin = plugin;
  return { state, view, plugin, removed, retained, removedBundle };
}

describe('unsubscribing and reader checkpoints', () => {
  it('removes only the unsubscribed source from checkpoints and the active reader while retaining saved copies', async () => {
    const { state, view, plugin, retained, removedBundle } = removalFixture();
    const otherChannel = structuredClone(state.channelStates[key(state, 'local:b')]);
    await plugin.removePersonalSources(['local:a']);
    expect(state.subscriptions.map(feed => feed.id)).toEqual(['local:b']);
    expect(state.channelStates[key(state, 'local:a')]).toBeUndefined();
    expect(state.channelStates[key(state, 'local:b')]).toEqual(otherChannel);
    for (const channel of Object.values(state.channelStates)) {
      expect(channel.entries).toEqual([retained]);
      expect(channel.bundle?.entry.sourceId).not.toBe('local:a');
      expect(channel.unread).not.toContain('removed');
    }
    expect(view.source).toBe('@local'); expect(view.bundle).toBeNull(); expect(view.entries).toEqual([retained]);
    expect(state.favorites.removed).toEqual(removedBundle);
    expect(state.cache.removed).toEqual(removedBundle);
    expect(state.savedArticles.removed).toEqual(removedBundle);
    expect(state.articleNotes['removed|original']).toBe('Saved.md');
    // Closing/switching after the live refresh cannot recreate the removed source checkpoint.
    view.saveChannel();
    const reloaded = initialState(JSON.parse(JSON.stringify(state)));
    expect(reloaded.channelStates[key(state, 'local:a')]).toBeUndefined();
    expect(reloaded.channelStates[key(state, '@local')].entries).toEqual([retained]);
  });

  it('rolls back checkpoint cleanup together with subscriptions if saving fails', async () => {
    const { state, plugin, view } = removalFixture();
    const before = structuredClone(state);
    plugin.persist.mockRejectedValueOnce(new Error('disk full'));
    await expect(plugin.removePersonalSources(['local:a'])).rejects.toThrow('disk full');
    expect(state).toEqual(before);
    expect(view.source).toBe('local:a');
  });

  it.each([
    { source: '@vault:Research', origin: 'vault' as const, settings: { markdownFolders: ['Research'] } },
    { source: 'podscribe-research', origin: 'qiaomu' as const, settings: { followedPodcasts: ['podscribe-research'] } },
  ])('drops a removed $source checkpoint without resurrecting it from the active reader', async ({ source, origin, settings }) => {
    const removed = entry('removed', source, origin), retained = entry('retained', 'local:b');
    const state = initialState({ settings, subscriptions: [{ id: 'local:b', url: 'https://example.org/b', name: 'B', entries: [retained] }] });
    state.channelStates[key(state, source)] = checkpoint([removed]);
    state.channelStates[key(state, '@local')] = checkpoint([retained]);
    const { view } = reader(state, source);
    view.entries = [removed]; view.bundle = bundle(removed);
    const plugin = Object.assign(Object.create(Plugin.prototype), {
      state, libraryEdits: Promise.resolve(), persist: vi.fn(async () => {}), refreshDiscovery: vi.fn(),
      app: { workspace: { getLeavesOfType: () => [{ view }] } },
    });
    view.plugin = plugin;
    await plugin.removePersonalSources([source]);
    view.saveChannel();
    expect(view.source).toBe('@local'); expect(view.entries).toEqual([retained]);
    expect(state.channelStates[key(state, source)]).toBeUndefined();
    expect(state.channelStates[key(state, '@local')].entries).toEqual([retained]);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function articleReader(state: State, source: string) {
  const result = reader(state, source), snapshots: State[] = [];
  state.settings.lastSource = source;
  result.plugin.persist.mockImplementation(async () => { snapshots.push(structuredClone(state)); });
  Object.assign(result.plugin, {
    remember: vi.fn((loaded: Bundle) => { state.cache[loaded.entry.id] = loaded; }),
    vaultSources: { article: vi.fn() },
  });
  return { ...result, snapshots, lastChannel: () => snapshots.at(-1)!.channelStates[key(state, source)] };
}

describe('article checkpoints without scrolling or closing a leaf', () => {
  it('persists a newly opened local article and restores it after a complete restart', async () => {
    const paper = { ...entry('paper'), content: '<p>Local research article</p>' };
    const state = initialState({ subscriptions: [{ id: 'local:a', url: 'https://example.org/rss', name: 'A', entries: [paper], updatedAt: Date.now() }] });
    const { view, plugin, snapshots, lastChannel } = articleReader(state, 'local:a');
    view.entries = [paper];

    await view.openArticle(paper);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].channelStates[key(state, 'local:a')]).toMatchObject({ articlePending: true, mode: 'original', bundle: { entry: paper } });
    expect(lastChannel()).toMatchObject({ articlePending: false, mode: 'original', bundle: { entry: paper } });
    expect(lastChannel().bundle!.fetchedAt).toBeGreaterThan(0);
    expect(plugin.persist).toHaveBeenCalledTimes(2);

    // Rehydrate only what persist saved; neither scroll nor onClose has run.
    const restoredState = initialState(snapshots.at(-1));
    const reopened = reader(restoredState);
    const transport = vi.fn();
    reopened.plugin.subscriptions = new Subscriptions(() => restoredState, reopened.plugin.persist, transport);
    reopened.view.reset();
    await vi.waitFor(() => expect(reopened.view.loading).toBe(false));
    expect(reopened.view.source).toBe('local:a');
    expect(reopened.view.bundle).toEqual(lastChannel().bundle);
    expect(reopened.view.articleLoading).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });

  it.each(['qiaomu', 'vault'] as const)('persists the final %s bundle after its asynchronous loader succeeds', async origin => {
    const source = origin === 'vault' ? '@vault:Papers' : 'news';
    const paper = entry('loaded-paper', source, origin);
    const state = initialState({ settings: { markdownFolders: ['Papers'], defaultMode: 'rewrite' } });
    const { view, plugin, snapshots, lastChannel } = articleReader(state, source);
    view.entries = [paper];
    const result = deferred<Bundle>(), fetched = { ...bundle(paper), entry: { ...paper, content: '<p>Complete fetched content</p>' }, fetchedAt: 20 };
    const loader = vi.fn(() => result.promise);
    if (origin === 'vault') plugin.vaultSources.article = loader;
    else plugin.api.mockReturnValue({ article: vi.fn(async () => ({ bundle: await loader(), warnings: [] })) });

    const opening = view.openArticle(paper);
    expect(lastChannel().articlePending).toBe(true);
    expect(lastChannel().bundle!.fetchedAt).toBe(0);
    result.resolve(fetched);
    await opening;
    expect(loader).toHaveBeenCalledOnce();
    expect(snapshots).toHaveLength(2);
    expect(lastChannel()).toMatchObject({ articlePending: false, mode: 'original', bundle: fetched });

    const reopened = reader(initialState(snapshots.at(-1)), source);
    reopened.view.restoreChannel(lastChannel());
    expect(reopened.view.bundle).toEqual(fetched);
    expect(reopened.plugin.api).not.toHaveBeenCalled();
  });

  it('does not let an older asynchronous article overwrite the newer article checkpoint', async () => {
    const older = entry('older', 'news', 'qiaomu'), newer = entry('newer', 'news', 'qiaomu');
    const state = initialState({});
    const { view, plugin, snapshots, lastChannel } = articleReader(state, 'news');
    view.entries = [older, newer];
    const oldResult = deferred<Bundle>(), newResult = deferred<Bundle>();
    const article = vi.fn(async (id: string) => ({ bundle: await (id === 'older' ? oldResult : newResult).promise, warnings: [] }));
    plugin.api.mockReturnValue({ article });
    const openingOld = view.openArticle(older), openingNew = view.openArticle(newer);
    newResult.resolve(bundle(newer)); await openingNew;
    const savedCount = snapshots.length;
    oldResult.resolve(bundle(older)); await openingOld;
    expect(article).toHaveBeenCalledTimes(2);
    expect(snapshots).toHaveLength(savedCount);
    expect(lastChannel()).toMatchObject({ articlePending: false, bundle: { entry: newer } });
    expect(view.bundle.entry).toEqual(newer);
    expect(plugin.remember).toHaveBeenCalledOnce();
  });

  it('resumes a pending checkpoint once, preserving its mode and offsets in both persisted phases', async () => {
    const paper = entry('resuming', 'news', 'qiaomu');
    const state = initialState({});
    const saved = { ...checkpoint([paper]), mode: 'translation' as const, articlePending: true };
    const { view, plugin, snapshots, lastChannel } = articleReader(state, 'news');
    const result = deferred<Bundle>(), loaded = { ...bundle(paper), fetchedAt: 20 };
    const article = vi.fn(async () => ({ bundle: await result.promise, warnings: [] }));
    plugin.api.mockReturnValue({ article });

    view.restoreChannel(saved);
    expect(lastChannel()).toMatchObject({ articlePending: true, mode: 'translation', listTop: 48, readerTop: 192 });
    result.resolve(loaded);
    await vi.waitFor(() => expect(view.articleLoading).toBe(false));
    expect(lastChannel()).toMatchObject({ articlePending: false, bundle: loaded, mode: 'translation', listTop: 48, readerTop: 192 });
    expect(article).toHaveBeenCalledOnce();
    expect(snapshots).toHaveLength(2);
    const reopened = reader(initialState(snapshots.at(-1)), 'news');
    reopened.view.restoreChannel(lastChannel());
    expect(reopened.view.bundle).toEqual(loaded);
    expect(reopened.plugin.api).not.toHaveBeenCalled();
  });

  it('persists the cached fallback as complete after a failed reload', async () => {
    const paper = entry('cached', 'news', 'qiaomu');
    const cached = { ...bundle(paper), entry: { ...paper, content: '<p>Offline saved text</p>' } };
    const state = initialState({ cache: { cached } });
    const { view, plugin, lastChannel } = articleReader(state, 'news');
    view.entries = [paper];
    const article = vi.fn(async () => { throw new Error('offline'); });
    plugin.api.mockReturnValue({ article });
    await view.openArticle(paper);
    expect(lastChannel()).toMatchObject({ articlePending: false, bundle: cached, mode: 'original' });
    expect(view.message).toContain('offline');
    expect(article).toHaveBeenCalledOnce();
  });

  it('persists a shown saved article and ignores a previous request that finishes afterward', async () => {
    const old = entry('old-request', 'news', 'qiaomu'), savedEntry = entry('saved', 'news', 'qiaomu');
    const state = initialState({});
    const { view, plugin, snapshots, lastChannel } = articleReader(state, 'news');
    view.entries = [old, savedEntry];
    const result = deferred<Bundle>();
    const article = vi.fn(async () => ({ bundle: await result.promise, warnings: [] }));
    plugin.api.mockReturnValue({ article });
    const opening = view.openArticle(old);
    const saved = { ...bundle(savedEntry), entry: { ...savedEntry, content: '<p>Saved snapshot</p>' } };
    view.showSavedArticle(saved, 'translation');
    expect(lastChannel()).toMatchObject({ articlePending: false, bundle: saved, mode: 'translation' });
    result.resolve(bundle(old)); await opening;
    expect(snapshots).toHaveLength(2);
    expect(lastChannel().bundle).toEqual(saved);
    const reopened = reader(initialState(snapshots.at(-1)), 'news');
    reopened.view.restoreChannel(lastChannel());
    expect(reopened.view.bundle).toEqual(saved);
    expect(reopened.view.mode).toBe('translation');
    expect(reopened.plugin.api).not.toHaveBeenCalled();
  });
});

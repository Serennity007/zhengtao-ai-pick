// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', async original => ({
  ...await original<object>(),
  Component: class {}, ItemView: class {}, Modal: class {}, FuzzySuggestModal: class {},
  MarkdownView: class {}, TFile: class {},
  Plugin: class {
    constructor(public app: unknown, public manifest: unknown) {}
    register = vi.fn();
    registerEvent = vi.fn();
    registerView = vi.fn();
    registerDomEvent = vi.fn();
    registerMarkdownPostProcessor = vi.fn();
    registerObsidianProtocolHandler = vi.fn();
    registerInterval = vi.fn((id: number) => window.clearInterval(id));
    addCommand = vi.fn();
    addRibbonIcon = vi.fn();
    addSettingTab = vi.fn();
  },
  PluginSettingTab: class { containerEl = document.createElement('div'); },
  Notice: vi.fn(class { hide = vi.fn(); }),
  Platform: { isDesktopApp: false, isMobileApp: false },
}));

import ZhengtaoPicksPlugin from '../src/main';
import { initialState, type State } from '../src/model';
import { PLUGIN_ID, READER_VIEW_TYPE } from '../src/identity';

beforeAll(() => {
  Object.defineProperty(window.crypto, 'subtle', { value: webcrypto.subtle, configurable: true });
  Object.assign(HTMLElement.prototype, {
    addClass(name: string) { this.classList.add(name); },
  });
});

function host(previous: unknown, predecessors: Record<string, unknown> = {}) {
  let ownData = previous;
  const adapter = {
    exists: vi.fn(async (path: string) => Object.hasOwn(predecessors, path)),
    read: vi.fn(async (path: string) => JSON.stringify(predecessors[path])),
    write: vi.fn(async () => {}),
  };
  const app = {
    vault: { configDir: '.obsidian', adapter, on: vi.fn(() => ({})) },
    workspace: {
      on: vi.fn(() => ({})), onLayoutReady: vi.fn(), trigger: vi.fn(),
      getActiveViewOfType: vi.fn(() => null),
    },
  };
  const loadData = vi.fn(async () => ownData);
  const saveData = vi.fn(async (data: State) => { ownData = structuredClone(data); });
  const create = () => Object.assign(new ZhengtaoPicksPlugin(app as never, { id: PLUGIN_ID } as never), { loadData, saveData });
  return { create, adapter, app, loadData, saveData, saved: () => ownData as State };
}

describe('plugin startup persistence', () => {
  it('persists first-run integration once and reuses it on the next startup without reading predecessors again', async () => {
    const fixture = host(null, {
      '.obsidian/plugins/qiaomu-ai-rss/data.json': { readIds: ['read-before-integration'] },
      '.obsidian/plugins/zhengtao-picks/data.json': { settings: { customFeeds: [{ feedUrl: 'https://lab.example/feed', name: 'Lab feed' }] } },
    });
    const first = fixture.create();
    await first.onload();
    expect(fixture.saveData).toHaveBeenCalledOnce();
    expect(fixture.saved().subscriptions).toHaveLength(24);
    expect(fixture.saved().readIds).toContain('read-before-integration');
    expect(fixture.adapter.read.mock.calls.map(([path]) => path)).toEqual([
      '.obsidian/plugins/qiaomu-ai-rss/data.json', '.obsidian/plugins/zhengtao-picks/data.json',
    ]);
    expect(fixture.adapter.write).not.toHaveBeenCalled();

    const persisted = structuredClone(fixture.saved());
    const second = fixture.create();
    await second.onload();
    expect(second.state).toEqual(persisted); // Includes the original group UUIDs.
    expect(fixture.saveData).toHaveBeenCalledOnce();
    expect(fixture.adapter.exists).toHaveBeenCalledTimes(2);
    expect(fixture.adapter.read).toHaveBeenCalledTimes(2);
    expect(second.registerView.mock.calls.map(([type]) => type)).toEqual([
      READER_VIEW_TYPE, 'zhengtao-ai-pick-discovery', 'zhengtao-ai-pick-library',
    ]);
    expect(second.registerObsidianProtocolHandler).toHaveBeenCalledOnce();
    expect(second.registerObsidianProtocolHandler.mock.calls[0][0]).toBe(PLUGIN_ID);
  });

  it('loads the user-owned state without reseeding removed feeds or overwriting reading preferences', async () => {
    const own = initialState({
      subscriptions: [{ id: 'local:mine', url: 'https://mine.example/feed', name: 'My feed', group: 'My group' }],
      settings: { lastSource: 'local:mine', defaultMode: 'translation', fontSize: 25, articleFolder: 'My clippings' },
      readIds: ['my-read-article'],
    });
    const fixture = host(own, {
      '.obsidian/plugins/qiaomu-ai-rss/data.json': { readIds: ['new-predecessor-read'] },
      '.obsidian/plugins/zhengtao-picks/data.json': { settings: { customFeeds: [{ feedUrl: 'https://unwanted.example/feed' }] } },
    });
    const plugin = fixture.create();
    await plugin.onload();
    expect(plugin.state).toEqual(own);
    expect(plugin.state.subscriptions).toHaveLength(1);
    expect(plugin.state.settings).toMatchObject({ lastSource: 'local:mine', defaultMode: 'translation', fontSize: 25, articleFolder: 'My clippings' });
    expect(fixture.adapter.exists).not.toHaveBeenCalled();
    expect(fixture.adapter.read).not.toHaveBeenCalled();
    expect(fixture.adapter.write).not.toHaveBeenCalled();
    expect(fixture.saveData).not.toHaveBeenCalled();
  });
});

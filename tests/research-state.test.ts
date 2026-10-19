// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
vi.mock('obsidian', async original => ({
  ...await original<object>(), Component: class {}, ItemView: class {}, Modal: class {}, FuzzySuggestModal: class {},
  Plugin: class {}, PluginSettingTab: class {}, MarkdownView: class {}, TFile: class {}, Notice: vi.fn(),
}));
import Plugin from '../src/main';
import { initialState, withServiceOrigin, type Entry } from '../src/model';

const entry: Entry = { id: 'local-paper', origin: 'local', sourceId: 'local:a', title: 'Agent memory', content: '<p>Original content</p>' };
function host() {
  const plugin = Object.assign(Object.create(Plugin.prototype) as Plugin, {
    state: initialState({ readIds: ['already-read'] }), researchWrites: Promise.resolve(),
    persist: vi.fn(async () => {}),
  });
  return plugin;
}
describe('research queue state', () => {
  it('adds defaults to old data without changing existing reader assets', () => {
    const state = initialState({ settings: { fontSize: 26 }, readIds: ['old'] });
    expect(state.researchQueue).toMatchObject({ days: 7, limit: 10, perSource: 2 });
    expect(state.readLater).toEqual({}); expect(state.settings.fontSize).toBe(26); expect(state.readIds).toEqual(['old']);
  });
  it('keeps a detached snapshot after source caches expire and across service changes', async () => {
    const plugin = host(), mutable = { ...entry }; await plugin.addReadLater(mutable);
    const key = plugin.readLaterKey(entry);
    mutable.content = '<p>Changed after saving</p>';
    expect(plugin.state.readLater[key].bundle.entry.content).toBe('<p>Original content</p>');
    plugin.state.cache = {}; plugin.state.subscriptions = [];
    const restored = initialState(JSON.parse(JSON.stringify(plugin.state)));
    expect(restored.readLater[key]).toEqual(plugin.state.readLater[key]);
    expect(withServiceOrigin(restored, 'https://another.example').readLater[key]).toEqual(restored.readLater[key]);
  });
  it('serializes additions without losing entries and does not alter read status', async () => {
    const plugin = host();
    expect(await Promise.all([plugin.addReadLater(entry), plugin.addReadLater({ ...entry, id: 'local-other' }), plugin.addReadLater(entry)])).toEqual([true, true, false]);
    expect(Object.keys(plugin.state.readLater)).toHaveLength(2); expect(plugin.state.readIds).toEqual(['already-read']);
  });
  it('rolls back failed saves and lets the user retry without losing existing snapshots', async () => {
    const plugin = host(); await plugin.addReadLater(entry); const before = structuredClone(plugin.state.readLater);
    vi.mocked(plugin.persist).mockRejectedValueOnce(new Error('Disk unavailable'));
    await expect(plugin.removeReadLater(plugin.readLaterKey(entry))).rejects.toThrow('Disk unavailable');
    expect(plugin.state.readLater).toEqual(before);
    await plugin.removeReadLater(plugin.readLaterKey(entry)); expect(plugin.state.readLater).toEqual({});
    expect(plugin.state.readIds).toEqual(['already-read']);
  });
  it('rolls back rule changes when persistence fails', async () => {
    const plugin = host(), before = structuredClone(plugin.state.researchQueue);
    vi.mocked(plugin.persist).mockRejectedValueOnce(new Error('Disk unavailable'));
    await expect(plugin.setResearchQueue({ ...before, keywords: 'planning' })).rejects.toThrow();
    expect(plugin.state.researchQueue).toEqual(before);
    await plugin.setResearchQueue({ ...before, keywords: 'planning' });
    expect(plugin.state.researchQueue.keywords).toBe('planning');
  });
});

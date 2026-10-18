// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { firstRunState } from '../src/first-run';
import { appendDailyNoteLink, articleNoteUrl, repairArticleLinks } from '../src/daily-note';
import { PLUGIN_ID, READER_VIEW_TYPE } from '../src/identity';
import type { Vault } from 'obsidian';

beforeAll(() => { Object.defineProperty(window.crypto, 'subtle', { value: webcrypto.subtle, configurable: true }); });

describe('independent installation and one-time import', () => {
  it('uses its own reader and vault-scoped return protocol', () => {
    expect(PLUGIN_ID).toBe('zhengtao-ai-pick');
    expect(READER_VIEW_TYPE).toBe('zhengtao-ai-pick-reader');
    const url = new URL(articleNoteUrl({ vault: '科研', article: 'local|paper' }));
    expect(url.hostname).toBe(PLUGIN_ID);
    expect(url.searchParams.get('vault')).toBe('科研');
  });
  it('preserves predecessor links instead of treating them as its own captured article', () => {
    const old = '[old](<obsidian://qiaomu-ai-rss?vault=Old+Vault&article=a>)\n\n';
    const entry = { id: 'a', sourceId: 'local:test', title: 'Paper', link: 'https://example.org/paper' };
    const result = appendDailyNoteLink(old, entry, { vault: '科研', article: 'a' });
    expect(repairArticleLinks(old)).toBe(old);
    expect(result.added).toBe(true);
    expect(result.content.startsWith(old)).toBe(true);
    expect(result.content).toContain('obsidian://zhengtao-ai-pick?');
  });
  it('reads each predecessor only from this vault configuration and never writes to either', async () => {
    const read = vi.fn(async () => JSON.stringify({ readIds: ['previously-read'] }));
    const write = vi.fn();
    const vault = { configDir: '.custom-config', adapter: { exists: vi.fn(async () => true), read, write } };
    const state = await firstRunState(vault as unknown as Pick<Vault, 'configDir' | 'adapter'>);
    expect(read.mock.calls.map(call => call[0])).toEqual([
      '.custom-config/plugins/qiaomu-ai-rss/data.json', '.custom-config/plugins/zhengtao-picks/data.json',
    ]);
    expect(state.readIds).toContain('previously-read');
    expect(write).not.toHaveBeenCalled();
  });
  it('seeds research feeds when predecessors are absent, and surfaces malformed data before saving', async () => {
    const absent = { configDir: '.obsidian', adapter: { exists: async () => false, read: vi.fn() } };
    expect((await firstRunState(absent as unknown as Pick<Vault, 'configDir' | 'adapter'>)).subscriptions).toHaveLength(23);
    expect(absent.adapter.read).not.toHaveBeenCalled();
    const broken = { configDir: '.obsidian', adapter: { exists: async () => true, read: async () => '{broken' } };
    await expect(firstRunState(broken as unknown as Pick<Vault, 'configDir' | 'adapter'>)).rejects.toBeInstanceOf(SyntaxError);
  });
});

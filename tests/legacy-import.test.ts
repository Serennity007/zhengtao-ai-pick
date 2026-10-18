// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { createIntegratedState } from '../src/legacy-import';
import { feedUrl, parseFeed, stableId } from '../src/feeds';
import { initialState, type Bundle } from '../src/model';
import { researchPriorityGroups, researchSources } from '../src/research-sources';

beforeAll(() => { Object.defineProperty(window.crypto, 'subtle', { value: webcrypto.subtle, configurable: true }); });
const bundle = (id: string, sourceId = 'remote-source'): Bundle => ({ entry: { id, sourceId, title: id, origin: sourceId.startsWith('local:') ? 'local' : 'qiaomu', content: '<p>Saved content</p>' }, rewrite: null, translation: null, fetchedAt: 10 });

describe('independent reader integration', () => {
  it('seeds all 23 sources offline with canonical parser IDs and pins research first', async () => {
    const state = await createIntegratedState(null, null);
    expect(state.subscriptions).toHaveLength(23);
    expect(new Set(state.subscriptions.map(feed => feed.url)).size).toBe(23);
    for (const feed of state.subscriptions) expect(feed.id).toBe(`local:${await stableId(feed.url)}`);
    const first = state.subscriptionGroups.find(group => group.id === state.settings.pinnedGroupIds[0]);
    expect(first?.name).toBe(researchPriorityGroups[0]);
    expect(state.settings.lastSource).toBe(`@group:${first?.id}`);
    expect(state.settings).toMatchObject({ folder: '正涛精选', articleFolder: '正涛精选/文章', defaultMode: 'original' });
    expect(initialState(state).subscriptions).toEqual(state.subscriptions);
  });

  it('normalizes URLs and combines duplicate cached entries while preserving personal metadata', async () => {
    const url = 'https://example.com/feed', sourceId = `local:${await stableId(url)}`;
    const first = bundle('cached-1', 'old-first').entry, second = bundle('cached-2', 'old-second').entry;
    const upstream = { subscriptions: [
      { id: 'old-first', url: '  HTTPS://EXAMPLE.COM:443/feed#section ', name: 'Personal title', group: 'My research', entries: [first], updatedAt: 20 },
      { id: 'old-second', url, name: 'Duplicate title', group: 'Other', entries: [second, first], updatedAt: 30 },
    ], sourceMeta: { 'old-first': { groupId: 'mine', name: 'Renamed', order: 1 } }, subscriptionGroups: [{ id: 'mine', name: 'My research', order: 0 }], favorites: { 'cached-1': bundle('cached-1', 'old-first') } };
    const state = await createIntegratedState(upstream, { settings: { customFeeds: [{ id: 'custom-1', feedUrl: `${url}#custom`, name: 'Legacy duplicate' }] } });
    const feeds = state.subscriptions.filter(feed => feed.url === url);
    expect(feeds).toHaveLength(1);
    expect(feeds[0]).toMatchObject({ id: sourceId, name: 'Personal title', group: 'My research', updatedAt: 30 });
    expect(feeds[0].entries.map(entry => entry.id)).toEqual(['cached-1', 'cached-2']);
    expect(feeds[0].entries.every(entry => entry.sourceId === sourceId)).toBe(true);
    expect(state.sourceMeta[sourceId]).toMatchObject({ groupId: 'mine', name: 'Renamed' });
    expect(state.sourceMeta['old-first']).toBeUndefined();
    expect(state.favorites['cached-1'].entry.sourceId).toBe(sourceId);
  });

  it('refuses source identity changes that would orphan read history without disclosing private addresses', async () => {
    const privateUrl = 'HTTPS://EXAMPLE.COM:443/feed?token=private-token#section';
    const oldSource = `local:${await stableId(privateUrl)}`, oldRead = `local-${await stableId(`${oldSource}\nurn:read-paper`)}`;
    const original = { subscriptions: [{ id: oldSource, url: privateUrl, name: 'Private subscription', group: 'Private group' }], readIds: [oldRead] };
    const before = JSON.stringify(original);
    for (const [upstream, legacy] of [[original, null], [null, original]]) {
      await expect(createIntegratedState(upstream, legacy)).rejects.toThrow('Cannot safely migrate read history after a subscription identity change.');
      try { await createIntegratedState(upstream, legacy); } catch (error) {
        expect(String(error)).not.toContain('private-token');
        expect(String(error)).not.toContain('EXAMPLE.COM');
        expect(String(error)).not.toContain(oldSource);
      }
    }
    expect(JSON.stringify(original)).toBe(before);
  });

  it('keeps existing read history when the stored source already uses the canonical parser ID', async () => {
    const url = 'https://example.com/feed', id = `local:${await stableId(url)}`;
    const readId = `local-${await stableId(`${id}\nurn:read-paper`)}`;
    const state = await createIntegratedState({ subscriptions: [{ id, url, name: 'Existing source', group: 'Existing group' }], readIds: [readId] }, null);
    expect(state.readIds).toContain(readId);
    expect(state.subscriptions.find(feed => feed.url === url)?.id).toBe(id);
  });

  it.each(['favorites', 'cache', 'savedArticles', 'entries', 'readIds'] as const)('refuses remote %s from a different legacy service', async field => {
    const remote = bundle('private-remote');
    const legacy = { settings: { baseUrl: 'https://private-service.example' }, [field]: field === 'entries' ? [remote.entry] : field === 'readIds' ? ['private-remote'] : { 'private-remote': remote } };
    const before = JSON.stringify(legacy);
    await expect(createIntegratedState(null, legacy)).rejects.toThrow('Cannot integrate reader assets from different services.');
    try { await createIntegratedState(null, legacy); } catch (error) {
      expect(String(error)).not.toContain('private-service');
      expect(String(error)).not.toContain('private-remote');
    }
    expect(JSON.stringify(legacy)).toBe(before);
  });

  it('permits local snapshots and read state from a legacy reader configured for another service', async () => {
    const url = 'https://local.example/feed', sourceId = `local:${await stableId(url)}`;
    const local = bundle('local-snapshot', sourceId);
    const state = await createIntegratedState(null, { settings: { baseUrl: 'https://other-service.example' }, subscriptions: [{ id: sourceId, url, name: 'Local source', group: 'Local group', entries: [local.entry] }], favorites: { 'local-snapshot': local }, readIds: ['local-read'] });
    expect(state.favorites['local-snapshot']).toEqual(local);
    expect(state.readIds).toContain('local-read');
    expect(state.settings.baseUrl).toBe(initialState(null).settings.baseUrl);
  });

  it('honors disabled curated sources, imports valid custom feeds, and retains explicit upstream subscriptions', async () => {
    const disabled = researchSources[0], customUrl = 'https://example.org/atom';
    const legacy = { settings: { disabledFeedIds: [disabled.legacyId], customFeeds: [
      { id: 'custom', feedUrl: customUrl, name: 'My lab' },
      { id: 'invalid', feedUrl: 'javascript:alert(1)', name: 'Invalid' },
      { id: 'credentials', feedUrl: 'https://user:secret@example.org/feed' },
    ] } };
    const state = await createIntegratedState(null, legacy);
    expect(state.subscriptions).toHaveLength(23);
    expect(state.subscriptions.some(feed => feed.url === disabled.url)).toBe(false);
    expect(state.subscriptions.find(feed => feed.url === customUrl)?.name).toBe('My lab');
    const explicit = await createIntegratedState({ subscriptions: [{ id: 'old', url: disabled.url, name: 'Explicit subscription', group: 'User choice' }] }, legacy);
    expect(explicit.subscriptions.find(feed => feed.url === disabled.url)?.name).toBe('Explicit subscription');
  });

  it('does not import disabled custom subscriptions or map their read identities', async () => {
    const customUrl = 'https://disabled.example/feed', identity = 'urn:disabled';
    const state = await createIntegratedState(null, { settings: { disabledFeedIds: ['custom-disabled'], customFeeds: [
      { id: 'custom-disabled', feedUrl: customUrl, name: 'Disabled custom' },
      { id: 'custom-active', feedUrl: 'https://active.example/feed', name: 'Active custom' },
    ] }, read: { [identity]: 1 } });
    expect(state.subscriptions.some(feed => feed.url === customUrl)).toBe(false);
    expect(state.subscriptions.some(feed => feed.url === 'https://active.example/feed')).toBe(true);
    const disabledRead = `local-${await stableId(`local:${await stableId(customUrl)}\n${identity}`)}`;
    expect(state.readIds).not.toContain(disabledRead);
  });

  it('organizes already-subscribed research feeds while retaining their content and original groups', async () => {
    const oldGroup = { id: 'old-group', name: '正涛精选', order: 0 };
    const subscriptions = await Promise.all(researchSources.map(async preset => {
      const id = `local:${await stableId(feedUrl(preset.url))}`;
      return { id, url: preset.url, name: `My ${preset.name}`, group: oldGroup.name, entries: [bundle(`saved-${preset.legacyId}`, id).entry] };
    }));
    const custom = { id: 'custom-before', url: 'https://custom.example/feed', name: 'Personal feed', group: oldGroup.name };
    const state = await createIntegratedState({ subscriptionGroups: [oldGroup], subscriptions: [...subscriptions, custom] }, null);
    expect(state.subscriptions).toHaveLength(24);
    expect(state.subscriptionGroups).toContainEqual(oldGroup);
    for (const preset of researchSources) {
      const feed = state.subscriptions.find(item => item.url === feedUrl(preset.url))!;
      const group = state.subscriptionGroups.find(item => item.id === state.sourceMeta[feed.id].groupId);
      expect(group?.name).toBe(preset.group);
      expect(feed.name).toBe(`My ${preset.name}`);
      expect(feed.entries.map(entry => entry.id)).toEqual([`saved-${preset.legacyId}`]);
    }
    const firstGroup = state.subscriptionGroups.find(group => group.id === state.settings.pinnedGroupIds[0]);
    expect(firstGroup?.name).toBe(researchPriorityGroups[0]);
    expect(state.settings.lastSource).toBe(`@group:${firstGroup?.id}`);
    const customFeed = state.subscriptions.find(feed => feed.url === custom.url)!;
    expect(customFeed.group).toBe(oldGroup.name);
    expect(state.sourceMeta[customFeed.id].groupId).toBe(oldGroup.id);
  });

  it('normalizes research pins before persistence when 50 personal groups were already pinned', async () => {
    const groups = Array.from({ length: 50 }, (_, order) => ({ id: `group-${order}`, name: `Personal ${order}`, order }));
    const state = await createIntegratedState({ subscriptionGroups: groups, settings: { pinnedGroupIds: groups.map(group => group.id) } }, null);
    expect(state.settings.pinnedGroupIds).toHaveLength(50);
    expect(state.subscriptionGroups).toHaveLength(55);
    expect(state.settings.pinnedGroupIds.slice(0, 2).map(id => state.subscriptionGroups.find(group => group.id === id)?.name)).toEqual([...researchPriorityGroups]);
    expect(initialState(state).settings.pinnedGroupIds).toEqual(state.settings.pinnedGroupIds);
  });

  it('maps old GUIDs and links to exactly the identities used by parseFeed', async () => {
    const source = researchSources[0], customUrl = 'https://lab.example/feed';
    const identity = 'urn:paper:123', link = 'https://lab.example/article';
    const disabled = researchSources[1];
    const state = await createIntegratedState(null, { settings: { disabledFeedIds: [disabled.legacyId], customFeeds: [{ feedUrl: customUrl, name: 'Lab' }] }, read: { [identity]: 1, [link]: 2, unread: false } });
    const parsed = await parseFeed(`<rss><channel><title>Lab</title><item><guid>${identity}</guid><title>Paper</title><link>${link}</link></item><item><title>Linked</title><link>${link}</link></item></channel></rss>`, customUrl, document);
    expect(parsed.entries.every(entry => state.readIds.includes(entry.id))).toBe(true);
    const expected = `local-${await stableId(`local:${await stableId(feedUrl(source.url))}\n${identity}`)}`;
    expect(state.readIds).toContain(expected);
    expect(state.readIds).not.toContain(identity);
    expect(state.readIds).not.toContain(link);
    const disabledRead = `local-${await stableId(`local:${await stableId(feedUrl(disabled.url))}\n${identity}`)}`;
    expect(state.readIds).not.toContain(disabledRead);
    expect(state.readIds.every(id => id.startsWith('local-'))).toBe(true);
  });

  it('keeps offline favorites, saved snapshots, note links, and read state from both readers', async () => {
    const upstream = { favorites: { remote: bundle('remote') }, savedArticles: { saved: bundle('saved') }, cache: { cached: bundle('cached') }, articleNotes: { 'saved|original': 'Research/saved.md' }, readIds: ['remote'], settings: { remoteImages: false, fontSize: 23, followedPodcasts: ['show-1'], markdownFolders: ['Papers'] } };
    const legacy = { favorites: { other: bundle('other') }, savedArticles: { 'saved-other': bundle('saved-other') }, readIds: ['other'], settings: { followedPodcasts: ['show-2'], markdownFolders: ['Notes'] } };
    const state = await createIntegratedState(upstream, legacy);
    expect(Object.keys(state.favorites)).toEqual(['other', 'remote']);
    expect(state.savedArticles.saved).toEqual(upstream.savedArticles.saved);
    expect(state.savedArticles['saved-other']).toEqual(legacy.savedArticles['saved-other']);
    expect(state.articleNotes['saved|original']).toBe('Research/saved.md');
    expect(state.cache.cached).toEqual(upstream.cache.cached);
    expect(state.readIds).toEqual(['remote', 'other']);
    expect(state.settings).toMatchObject({ remoteImages: false, fontSize: 23, followedPodcasts: ['show-1', 'show-2'], markdownFolders: ['Papers', 'Notes'] });
  });

  it('does not copy service credentials or mutate either source object', async () => {
    const upstream = { collectionIdentity: { id: 'private-identity', key: 'private-key' }, collectionAdminSession: { token: 'private-token', expiresAt: 1, name: 'admin', baseUrl: 'https://example.org' }, settings: { labInviteCode: 'private-invite', labInviteVerified: true, labCollection: true }, subscriptions: [{ id: 'old', url: 'https://test.example/feed', name: 'Unchanged', group: 'My group', entries: [bundle('snapshot', 'old').entry] }], favorites: { snapshot: bundle('snapshot', 'old') } };
    const legacy = { settings: { customFeeds: [{ feedUrl: 'https://custom.example/feed', name: 'Custom' }] }, read: { 'urn:old': 1 } };
    const beforeUpstream = JSON.stringify(upstream), beforeLegacy = JSON.stringify(legacy);
    const state = await createIntegratedState(upstream, legacy);
    expect(state.collectionIdentity).toBeNull();
    expect(state.collectionAdminSession).toBeNull();
    expect(state.collectionJobs).toEqual([]);
    expect(state.settings).toMatchObject({ labCollection: false, labInviteVerified: false, labInviteCode: '' });
    expect(JSON.stringify(state)).not.toContain('private-');
    expect(JSON.stringify(upstream)).toBe(beforeUpstream);
    expect(JSON.stringify(legacy)).toBe(beforeLegacy);
  });

  it('merges same-name groups and remaps collisions without losing pins or source assignments', async () => {
    const upstream = { subscriptionGroups: [{ id: 'one', name: 'My group', order: 0 }], settings: { pinnedGroupIds: ['one'] } };
    const legacy = { subscriptionGroups: [{ id: 'same-name', name: 'My group', order: 0 }, { id: 'one', name: 'Second group', order: 1 }], settings: { pinnedGroupIds: ['same-name', 'one'] }, subscriptions: [{ id: 'local-old', url: 'https://custom.example/feed', name: 'Custom', group: 'Second group' }], sourceMeta: { 'local-old': { groupId: 'one', name: 'Custom label', order: 0 } } };
    const state = await createIntegratedState(upstream, legacy);
    expect(state.subscriptionGroups.filter(group => group.name === 'My group')).toHaveLength(1);
    const secondGroup = state.subscriptionGroups.find(group => group.name === 'Second group');
    expect(secondGroup?.id).not.toBe('one');
    expect(state.settings.pinnedGroupIds).toContain(secondGroup?.id);
    const feed = state.subscriptions.find(feed => feed.url === 'https://custom.example/feed')!;
    expect(state.sourceMeta[feed.id].groupId).toBe(secondGroup?.id);
  });
});

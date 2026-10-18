import { feedUrl, stableId } from './feeds';
import { initialState, stateSchema, subscriptionSchema, type Entry, type State, type Subscription } from './model';
import { ensureGroup, groupKey, registerSource } from './personal-library';
import { researchPriorityGroups, researchSources } from './research-sources';

type ObjectData = Record<string, unknown>;
function object(value: unknown): ObjectData { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectData : {}; }
function text(value: unknown): string { return typeof value === 'string' ? value : ''; }

/** Only durable reader data crosses plugin identities; credentials and server jobs do not. */
function readerState(data: unknown): State {
  const raw = object(data), picked: ObjectData = {};
  for (const key of ['libraryVersion', 'subscriptionGroups', 'sourceMeta', 'collapsedGroups', 'deletedEntries', 'readIds', 'favorites', 'entries', 'sources', 'subscriptions', 'savedArticles', 'articleNotes', 'cache', 'updatedAt'] as const) {
    const parsed = stateSchema.shape[key].safeParse(raw[key]);
    if (parsed.success) picked[key] = parsed.data;
  }
  const settings: ObjectData = {}, previous = object(raw.settings);
  for (const key of ['baseUrl', 'folder', 'articleFolder', 'defaultMode', 'remoteImages', 'listWidth', 'readingTheme', 'fontSize', 'customFont', 'fontFamily', 'lineHeight', 'lineWidth', 'selectionPopup', 'markdownFolders', 'followedPodcasts', 'podcastNames', 'pickedSourceIds', 'pinnedGroupIds', 'lastSource', 'pdfDirectory'] as const) {
    const parsed = stateSchema.shape.settings.unwrap().shape[key].safeParse(previous[key]);
    if (parsed.success) settings[key] = parsed.data;
  }
  picked.settings = settings;
  return initialState(picked);
}

function mergeReaderAssets(target: State, source: State): Map<string, string> {
  const groupIds = new Map<string, string>();
  for (const group of source.subscriptionGroups) {
    let existing = target.subscriptionGroups.find(item => groupKey(item.name) === groupKey(group.name));
    if (!existing) {
      let id = group.id;
      while (target.subscriptionGroups.some(item => item.id === id)) id = `legacy:${id}`;
      existing = { id, name: group.name, order: target.subscriptionGroups.length };
      target.subscriptionGroups.push(existing);
    }
    groupIds.set(group.id, existing.id);
  }
  for (const [id, meta] of Object.entries(source.sourceMeta)) if (!target.sourceMeta[id]) target.sourceMeta[id] = { ...meta, groupId: groupIds.get(meta.groupId) || '' };
  target.collapsedGroups = [...new Set([...target.collapsedGroups, ...source.collapsedGroups.map(id => groupIds.get(id) || id)])];
  target.settings.pinnedGroupIds = [...new Set([...target.settings.pinnedGroupIds, ...source.settings.pinnedGroupIds.map(id => groupIds.get(id) || id)])];
  target.settings.markdownFolders = [...new Set([...target.settings.markdownFolders, ...source.settings.markdownFolders])];
  target.settings.followedPodcasts = [...new Set([...target.settings.followedPodcasts, ...source.settings.followedPodcasts])];
  target.settings.podcastNames = { ...source.settings.podcastNames, ...target.settings.podcastNames };
  target.readIds = [...new Set([...target.readIds, ...source.readIds])];
  target.favorites = { ...source.favorites, ...target.favorites };
  target.savedArticles = { ...source.savedArticles, ...target.savedArticles };
  target.articleNotes = { ...source.articleNotes, ...target.articleNotes };
  target.cache = { ...source.cache, ...target.cache };
  target.entries = uniqueEntries([...target.entries, ...source.entries]);
  const sources = new Map(target.sources.map(item => [item.id, item]));
  for (const item of source.sources) if (!sources.has(item.id)) sources.set(item.id, item);
  target.sources = [...sources.values()];
  for (const [id, deleted] of Object.entries(source.deletedEntries)) target.deletedEntries[id] = [...new Set([...(target.deletedEntries[id] || []), ...deleted])];
  return groupIds;
}

function uniqueEntries(entries: Entry[]): Entry[] {
  const seen = new Set<string>();
  return entries.filter(entry => !seen.has(entry.id) && Boolean(seen.add(entry.id)));
}

/**
 * One-time offline import for the independent plugin. Call only when its own data
 * is absent, then persist the returned state. No old plugin files are modified.
 */
export async function createIntegratedState(upstreamData: unknown, legacyData: unknown): Promise<State> {
  const state = readerState(upstreamData), legacy = readerState(legacyData);
  const remote = (entry: Entry) => entry.origin !== 'local' && entry.origin !== 'vault';
  const legacyRemoteAssets = legacy.entries.some(remote) || [legacy.cache, legacy.favorites, legacy.savedArticles].some(values => Object.values(values).some(bundle => remote(bundle.entry))) || legacy.readIds.some(id => !id.startsWith('local-') && !id.startsWith('vault:'));
  if (state.settings.baseUrl.replace(/\/+$/, '') !== legacy.settings.baseUrl.replace(/\/+$/, '') && legacyRemoteAssets) {
    throw new Error('Cannot integrate reader assets from different services.');
  }
  mergeReaderAssets(state, legacy);
  const previousFeeds = [...state.subscriptions, ...legacy.subscriptions];
  state.subscriptions = [];
  const byUrl = new Map<string, Subscription>(), sourceIds = new Map<string, string>();
  const add = async (input: { url: string; name: string; group: string; site?: string }, existing?: Subscription) => {
    let url: string;
    try { url = feedUrl(input.url); } catch { return; }
    const id = `local:${await stableId(url)}`;
    if (existing && existing.id !== id && state.readIds.length) {
      throw new Error('Cannot safely migrate read history after a subscription identity change.');
    }
    if (existing) sourceIds.set(existing.id, id);
    const present = byUrl.get(url);
    if (present) {
      if (existing) {
        present.entries = uniqueEntries([...present.entries, ...existing.entries]);
        present.updatedAt = Math.max(present.updatedAt, existing.updatedAt);
        present.lastAttemptAt = Math.max(present.lastAttemptAt, existing.lastAttemptAt);
      }
      return;
    }
    const feed = subscriptionSchema.parse({ ...existing, ...input, id, url });
    byUrl.set(url, feed); state.subscriptions.push(feed);
  };
  for (const feed of previousFeeds) await add(feed, feed);

  const settings = object(object(legacyData).settings);
  const disabled = new Set(Array.isArray(settings.disabledFeedIds) ? settings.disabledFeedIds.filter((id): id is string => typeof id === 'string') : []);
  const activeLegacyUrls = new Set<string>();
  for (const preset of researchSources) {
    if (disabled.has(preset.legacyId)) continue;
    await add(preset);
    activeLegacyUrls.add(feedUrl(preset.url));
  }
  if (Array.isArray(settings.customFeeds)) for (const raw of settings.customFeeds) {
    const custom = object(raw);
    if (disabled.has(text(custom.id))) continue;
    const url = text(custom.feedUrl) || text(custom.url);
    try {
      const canonical = feedUrl(url);
      await add({ url: canonical, name: text(custom.name).trim() || new URL(canonical).hostname, group: text(custom.group).trim() || '自定义订阅', site: text(custom.siteUrl) || text(custom.site) || undefined });
      activeLegacyUrls.add(canonical);
    } catch { /* Invalid legacy custom addresses never become subscriptions. */ }
  }

  // A canonical URL may change an old source key. Existing article IDs stay intact
  // because their original GUID is unavailable; the cached articles remain usable.
  for (const [oldId, newId] of sourceIds) {
    if (oldId !== newId && state.sourceMeta[oldId]) {
      state.sourceMeta[newId] ??= state.sourceMeta[oldId]; delete state.sourceMeta[oldId];
    }
    if (oldId !== newId && state.deletedEntries[oldId]) {
      state.deletedEntries[newId] = [...new Set([...(state.deletedEntries[newId] || []), ...state.deletedEntries[oldId]])]; delete state.deletedEntries[oldId];
    }
  }
  const remapEntry = (entry: Entry) => { entry.sourceId = sourceIds.get(entry.sourceId) || entry.sourceId; };
  for (const feed of state.subscriptions) { for (const entry of feed.entries) remapEntry(entry); registerSource(state, feed.id, feed.group); }
  // Existing subscriptions can predate the research grouping. Organize matched
  // public sources without replacing their names, cached entries, or old groups.
  for (const preset of researchSources) {
    const feed = byUrl.get(feedUrl(preset.url));
    if (!feed) continue;
    feed.group = preset.group;
    state.sourceMeta[feed.id].groupId = ensureGroup(state, preset.group);
  }
  for (const entry of state.entries) remapEntry(entry);
  for (const values of [state.cache, state.favorites, state.savedArticles]) for (const bundle of Object.values(values)) remapEntry(bundle.entry);

  // The minimal reader stored GUIDs or article links without a feed identifier.
  // Expand each identity over its active feeds so future parseFeed IDs match,
  // without retaining a second copy of those raw identities in the new data.
  const readMap = object(object(legacyData).read), readIds = new Set(state.readIds);
  const legacySourceIds = [...activeLegacyUrls].map(url => byUrl.get(url)!.id);
  for (const [identity, marked] of Object.entries(readMap)) {
    if (!identity || !marked) continue;
    const mapped = await Promise.all(legacySourceIds.map(async sourceId => `local-${await stableId(`${sourceId}\n${identity}`)}`));
    for (const id of mapped) readIds.add(id);
  }
  state.readIds = [...readIds];
  state.settings.folder = '正涛精选';
  state.settings.articleFolder = '正涛精选/文章';
  state.settings.defaultMode = 'original';
  const priority = researchPriorityGroups.map(name => state.subscriptionGroups.find(group => groupKey(group.name) === groupKey(name))?.id).filter((id): id is string => Boolean(id));
  state.settings.pinnedGroupIds = [...new Set([...priority, ...state.settings.pinnedGroupIds])];
  state.collapsedGroups = state.collapsedGroups.filter(id => !priority.includes(id));
  state.settings.lastSource = priority.length ? `@group:${priority[0]}` : '@local';
  return initialState(state);
}

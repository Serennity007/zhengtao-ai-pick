// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type ZhengtaoPicksPlugin from '../src/main';
import { initialState, type Bundle, type Entry } from '../src/model';
import { buildResearchQueue, researchTopics, type QueuePreferences } from '../src/research-queue';

vi.mock('obsidian', async () => ({
  ...await vi.importActual<Record<string, unknown>>('obsidian'),
  Modal: class {
    modalEl = document.createElement('div');
    contentEl = document.createElement('div');
    constructor() { this.modalEl.append(this.contentEl); document.body.append(this.modalEl); }
    setTitle() {}
    close() { (this as { onClose?: () => void }).onClose?.(); this.modalEl.remove(); }
  },
  Notice: class {},
}));
import { ResearchQueueModal } from '../src/research-queue-modal';

beforeAll(() => {
  Object.assign(HTMLElement.prototype, {
    addClass(...names: string[]) { this.classList.add(...names); },
    empty() { this.replaceChildren(); },
    setText(text: string) { this.textContent = text; },
    createEl(tag: string, options: { cls?: string; text?: string; type?: string; value?: string; attr?: Record<string, string> } = {}) {
      const el = document.createElement(tag);
      if (options.cls) el.className = options.cls;
      if (options.text) el.textContent = options.text;
      if (options.type) el.setAttribute('type', options.type);
      if (options.value !== undefined) el.setAttribute('value', options.value);
      for (const [key, value] of Object.entries(options.attr ?? {})) el.setAttribute(key, String(value));
      this.append(el); return el;
    },
    createDiv(options: string | { cls?: string; text?: string; attr?: Record<string, string> }) {
      return this.createEl('div', typeof options === 'string' ? { cls: options } : options);
    },
    createSpan(options: { text?: string }) { return this.createEl('span', options); },
  });
});
afterEach(() => { document.body.replaceChildren(); });

const now = Date.UTC(2026, 9, 19);
const first: Entry = { id: 'memory', origin: 'local', sourceId: 'source', title: 'Agent Memory evaluation', summary: 'Research abstract', content: '<p>Locally cached body</p>', publishedTs: now - 3600000 };
const planning: Entry = { id: 'planning', origin: 'local', sourceId: 'source', title: '长期规划的新方法', publishedTs: now - 7200000 };
const snapshot = (article: Entry): Bundle => ({ entry: article, rewrite: null, translation: null, fetchedAt: now });
const key = (article: Entry) => `local|${article.id}`;
function plugin() {
  const state = initialState({
    subscriptions: [{ id: 'source', name: '研究公众号', url: 'https://example.org/rss', entries: [first, planning] }],
    researchQueue: { keywords: 'agent memory', exclude: '', days: 7, limit: 10, perSource: 2 },
  });
  const p = {
    app: {}, state,
    getResearchQueue: vi.fn(() => buildResearchQueue(state.subscriptions.flatMap(feed => feed.entries), state.researchQueue, state.readIds, now)),
    readLaterKey: key,
    setResearchQueue: vi.fn(async (preferences: QueuePreferences) => { state.researchQueue = preferences; }),
    addReadLater: vi.fn(async (article: Entry) => {
      if (state.readLater[key(article)]) return false;
      state.readLater[key(article)] = { bundle: snapshot(structuredClone(article)), savedAt: now }; return true;
    }),
    removeReadLater: vi.fn(async (id: string) => { delete state.readLater[id]; }),
    openResearchArticle: vi.fn().mockResolvedValue(undefined),
    refreshResearchQueue: vi.fn().mockResolvedValue(undefined),
  };
  return p;
}
function open(p = plugin()) {
  const modal = new ResearchQueueModal(p as unknown as ZhengtaoPicksPlugin); modal.onOpen(); return modal;
}
function button(modal: ResearchQueueModal, text: string, scope: ParentNode = modal.contentEl) {
  const result = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === text);
  if (!result) throw new Error(`Missing button ${text}`);
  return result;
}
function field(modal: ResearchQueueModal, name: string) {
  return modal.contentEl.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)!;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve };
}
const cards = (modal: ResearchQueueModal) => [...modal.contentEl.querySelectorAll<HTMLElement>('article')];

describe('research queue modal interaction', () => {
  it('renders cached personal RSS titles, sources and match reasons without fetching', () => {
    const p = plugin(); const modal = open(p);
    expect(cards(modal)).toHaveLength(1);
    expect(cards(modal)[0].textContent).toContain('Agent Memory evaluation');
    expect(cards(modal)[0].textContent).toContain('研究公众号');
    expect(cards(modal)[0].textContent).toContain('命中：agent memory');
    expect(modal.contentEl.querySelectorAll('select option')).toHaveLength(4);
    expect(p.refreshResearchQueue).not.toHaveBeenCalled();
    expect(p.openResearchArticle).not.toHaveBeenCalled();
  });

  it('keeps topic and custom edits as drafts until valid rules are explicitly saved', async () => {
    const p = plugin(); const modal = open(p);
    const topics = modal.contentEl.querySelector<HTMLSelectElement>('select')!;
    topics.value = 'planning'; topics.dispatchEvent(new Event('change'));
    expect(field(modal, 'keywords').value).toBe(researchTopics[2].keywords);
    expect(p.setResearchQueue).not.toHaveBeenCalled();
    expect(cards(modal)[0].textContent).toContain('Agent Memory evaluation');
    field(modal, 'keywords').value = '长期规划'; field(modal, 'keywords').dispatchEvent(new Event('input'));
    field(modal, 'exclude').value = '课程,广告';
    field(modal, 'days').value = '14'; field(modal, 'limit').value = '8'; field(modal, 'perSource').value = '1';
    expect(topics.value).toBe('custom');
    button(modal, '保存规则').click();
    await vi.waitFor(() => expect(p.setResearchQueue).toHaveBeenCalledExactlyOnceWith({ keywords: '长期规划', exclude: '课程,广告', days: 14, limit: 8, perSource: 1 }));
    await vi.waitFor(() => expect(cards(modal)[0].textContent).toContain('长期规划的新方法'));
    expect(modal.contentEl.textContent).toContain('科研队列规则已保存');
  });

  it('rejects out-of-range and noninteger rules using the form constraints', () => {
    const p = plugin(); const modal = open(p);
    const form = modal.contentEl.querySelector('form')!;
    for (const [name, value] of [['days', '0'], ['days', '91'], ['limit', '51'], ['perSource', '6'], ['limit', '1.5']]) {
      const input = field(modal, name), previous = input.value;
      input.value = value; form.dispatchEvent(new Event('submit', { cancelable: true }));
      expect(p.setResearchQueue).not.toHaveBeenCalled(); input.value = previous;
    }
  });

  it('retains drafts and cached recommendations after save failure, then permits a retry', async () => {
    const p = plugin(); p.setResearchQueue.mockRejectedValueOnce(new Error('disk full'));
    const modal = open(p); field(modal, 'keywords').value = '长期规划';
    button(modal, '保存规则').click();
    await vi.waitFor(() => expect(modal.contentEl.textContent).toContain('保存失败，请重试。'));
    expect(field(modal, 'keywords').value).toBe('长期规划');
    expect(p.state.researchQueue.keywords).toBe('agent memory');
    expect(cards(modal)[0].textContent).toContain('Agent Memory evaluation');
    expect(button(modal, '保存规则').disabled).toBe(false);
    button(modal, '保存规则').click();
    await vi.waitFor(() => expect(p.state.researchQueue.keywords).toBe('长期规划'));
    expect(p.setResearchQueue).toHaveBeenCalledTimes(2);
  });

  it('prevents repeated writes while a save is pending', async () => {
    const p = plugin(), pending = deferred(); p.setResearchQueue.mockImplementationOnce(() => pending.promise);
    const modal = open(p), save = button(modal, '保存规则');
    save.click(); save.click();
    modal.contentEl.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(p.setResearchQueue).toHaveBeenCalledTimes(1);
    expect([...modal.contentEl.querySelectorAll<HTMLButtonElement>('button')].every(item => item.disabled)).toBe(true);
    pending.resolve(); await vi.waitFor(() => expect(save.disabled).toBe(false));
  });

  it('saves a cached snapshot once and makes it available after reopening the modal', async () => {
    const p = plugin(), modal = open(p);
    const save = button(modal, '稍后读', cards(modal)[0]); save.click(); save.click();
    await vi.waitFor(() => expect(button(modal, '已加入稍后读', cards(modal)[0]).disabled).toBe(true));
    expect(p.addReadLater).toHaveBeenCalledExactlyOnceWith(first);
    modal.close();
    const reopened = open(p); button(reopened, '稍后读').click();
    expect(cards(reopened)[0].textContent).toContain(first.title);
    expect(reopened.contentEl.querySelector('form')!.hidden).toBe(true);
    button(reopened, '阅读', cards(reopened)[0]).click();
    expect(reopened.contentEl.childElementCount).toBe(0);
    expect(p.openResearchArticle).toHaveBeenCalledExactlyOnceWith(first, p.state.readLater[key(first)].bundle);
  });

  it('shows saved articles regardless of filters, age or read status, sorted by saved time', () => {
    const p = plugin();
    const old = { ...first, id: 'old', title: 'Archived unrelated article', publishedTs: 1 };
    p.state.readLater[key(old)] = { bundle: snapshot(old), savedAt: now - 5 };
    p.state.readLater[key(planning)] = { bundle: snapshot(planning), savedAt: now };
    p.state.readIds = [old.id, planning.id];
    const modal = open(p); expect(cards(modal)).toHaveLength(1);
    button(modal, '稍后读').click();
    expect(cards(modal).map(card => card.querySelector('h3')!.textContent)).toEqual([planning.title, old.title]);
    expect(p.refreshResearchQueue).not.toHaveBeenCalled();
  });

  it('keeps a saved item on removal failure and retries without deleting another collection', async () => {
    const p = plugin();
    p.state.readLater[key(first)] = { bundle: snapshot(first), savedAt: now };
    p.state.favorites[first.id] = snapshot(first); p.state.savedArticles[first.id] = snapshot(first);
    p.removeReadLater.mockRejectedValueOnce(new Error('write failed'));
    const modal = open(p); button(modal, '稍后读').click(); button(modal, '移出稍后读').click();
    await vi.waitFor(() => expect(modal.contentEl.textContent).toContain('保存失败，请重试。'));
    expect(cards(modal)).toHaveLength(1);
    button(modal, '移出稍后读').click();
    await vi.waitFor(() => expect(modal.contentEl.textContent).toContain('稍后读列表为空。'));
    expect(p.removeReadLater).toHaveBeenCalledTimes(2);
    expect(p.state.favorites[first.id]).toBeDefined(); expect(p.state.savedArticles[first.id]).toBeDefined();
    expect(p.state.subscriptions[0].entries).toHaveLength(2);
  });

  it('only refreshes on request, reports failure, and allows retry using the modal document', async () => {
    const p = plugin(); p.refreshResearchQueue.mockRejectedValueOnce(new Error('offline'));
    const modal = open(p); expect(p.refreshResearchQueue).not.toHaveBeenCalled();
    button(modal, '刷新订阅（最多 20 个源）').click();
    await vi.waitFor(() => expect(modal.contentEl.textContent).toContain('读取失败，请重试。'));
    expect(cards(modal)).toHaveLength(1);
    button(modal, '刷新订阅（最多 20 个源）').click();
    await vi.waitFor(() => expect(p.refreshResearchQueue).toHaveBeenCalledTimes(2));
    expect(p.refreshResearchQueue).toHaveBeenLastCalledWith(modal.contentEl.ownerDocument);
  });

  it('does not update detached controls or repopulate the modal after closing during an operation', async () => {
    const p = plugin(), pending = deferred(); p.setResearchQueue.mockImplementationOnce(() => pending.promise);
    const modal = open(p), save = button(modal, '保存规则');
    save.click(); const status = modal.contentEl.querySelector('[role=status]')!;
    expect(status.textContent).toBe('正在读取…'); modal.close(); pending.resolve();
    await Promise.resolve(); await Promise.resolve();
    expect(modal.contentEl.childElementCount).toBe(0);
    expect(status.textContent).toBe('正在读取…'); expect(save.disabled).toBe(true);
  });

  it('treats article titles as text instead of rendering markup', () => {
    const p = plugin(); p.state.subscriptions[0].entries = [{ ...first, title: '<img src=x onerror=alert(1)> agent memory' }];
    const modal = open(p);
    expect(modal.contentEl.querySelector('img')).toBeNull();
    expect(cards(modal)[0].querySelector('h3')!.textContent).toContain('<img');
  });

  it('groups two interpretations in selected reading but preserves separate read-later snapshots and original reading actions', () => {
    const p = plugin();
    const a = { ...first, link: 'https://arxiv.org/abs/2601.12345v1' };
    const b: Entry = { ...first, id: 'second-interpretation', sourceId: 'second', title: 'Agent Memory 另一份解读', link: 'https://arxiv.org/pdf/2601.12345v2.pdf' };
    p.state.subscriptions[0].entries = [a];
    p.state.subscriptions.push({ ...p.state.subscriptions[0], id: 'second', name: '另一公众号', url: 'https://second.example.org/rss', entries: [b] });
    p.state.readLater[key(a)] = { bundle: snapshot(a), savedAt: now - 1 };
    p.state.readLater[key(b)] = { bundle: snapshot(b), savedAt: now };
    const modal = open(p), group = modal.contentEl.querySelector<HTMLDetailsElement>('details.qrs-paper-group')!;
    expect(group).not.toBeNull(); expect(group.querySelectorAll('article')).toHaveLength(2);
    expect(group.querySelectorAll('button')).toHaveLength(4);
    expect(cards(modal).map(card => card.querySelector('h3')!.textContent)).toEqual([a.title, b.title]);
    button(modal, '阅读', cards(modal)[0]).click();
    expect(p.openResearchArticle).toHaveBeenLastCalledWith(a, undefined);
    const reopened = open(p); button(reopened, '稍后读').click();
    expect(reopened.contentEl.querySelector('details.qrs-paper-group')).toBeNull();
    expect(cards(reopened).map(card => card.querySelector('h3')!.textContent)).toEqual([b.title, a.title]);
    button(reopened, '阅读', cards(reopened)[0]).click();
    expect(p.openResearchArticle).toHaveBeenLastCalledWith(b, p.state.readLater[key(b)].bundle);
  });
});

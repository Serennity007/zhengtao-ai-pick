import { describe, expect, it } from 'vitest';
import type { Entry } from '../src/model';
import { buildResearchQueue, parseQueueKeywords, researchTopics, type QueuePreferences } from '../src/research-queue';

const now = Date.UTC(2026, 9, 19, 12);
const day = 86400000;
const preferences: QueuePreferences = { keywords: 'agent memory, 长期规划', exclude: '', days: 7, limit: 20, perSource: 3 };
const entry = (id: string, patch: Partial<Entry> = {}): Entry => ({
  id, sourceId: id, title: 'Agent Memory', publishedTs: now - day, ...patch,
});
const ids = (entries: Entry[], patch: Partial<QueuePreferences> = {}, readIds: string[] = []) =>
  buildResearchQueue(entries, { ...preferences, ...patch }, readIds, now).map(item => item.entry.id);

describe('research reading queue', () => {
  it('parses supported delimiters, preserves spelling, and deduplicates without case sensitivity', () => {
    expect(parseQueueKeywords(' Agent Memory，agent MEMORY;长期规划；工作流\n memory retrieval\r\n;; '))
      .toEqual(['Agent Memory', '长期规划', '工作流', 'memory retrieval']);
  });

  it('limits distinct keywords and ignores overlong terms rather than matching an accidental prefix', () => {
    const words = Array.from({ length: 70 }, (_, i) => `term ${i}`);
    expect(parseQueueKeywords(`${'x'.repeat(81)},${words.join(',')}`)).toEqual(words.slice(0, 50));
    expect(parseQueueKeywords('x'.repeat(80))).toEqual(['x'.repeat(80)]);
  });

  it('offers three bilingual research topics', () => {
    expect(researchTopics.map(topic => topic.id)).toEqual(['memory', 'workflow', 'planning']);
    expect(researchTopics.map(topic => topic.name)).toEqual(['多智能体记忆', 'Agent 工作流', '长期规划']);
    for (const topic of researchTopics) {
      expect(parseQueueKeywords(topic.keywords).some(word => /[\u4e00-\u9fff]/.test(word))).toBe(true);
      expect(parseQueueKeywords(topic.keywords).some(word => /[a-z]/i.test(word))).toBe(true);
    }
  });

  it('matches any keyword in either language across only titles and summaries', () => {
    const entries = [
      entry('title'),
      entry('translated-title', { title: 'Planning', titleZh: '长期规划的新方法' }),
      entry('summary', { title: 'A paper', summary: 'Evaluation of AGENT MEMORY systems' }),
      entry('translated-summary', { title: 'A paper', summaryZh: '本文研究长期规划。' }),
      entry('publisher-only', { title: 'Unrelated', sourceName: 'agent memory' }),
      entry('body-only', { title: 'Unrelated', content: '<p>agent memory</p>', markdown: '长期规划' }),
      entry('no-match', { title: 'Unrelated' }),
    ];
    expect(ids(entries)).toEqual(['title', 'translated-title', 'summary', 'translated-summary']);
  });

  it('excludes any unwanted term even when multiple desired keywords match, and excludes read articles', () => {
    const entries = [
      entry('keep'),
      entry('advertisement', { title: 'Agent Memory 长期规划', summaryZh: '限时课程推广' }),
      entry('english-exclusion', { summary: 'A SPONSORED article' }),
      entry('read'),
    ];
    expect(ids(entries, { exclude: '课程，sponsored' }, ['read'])).toEqual(['keep']);
  });

  it('uses an inclusive recent window and permits only five minutes of future clock skew', () => {
    expect(ids([
      entry('earliest', { publishedTs: now - 7 * day }),
      entry('too-old', { publishedTs: now - 7 * day - 1 }),
      entry('now', { publishedTs: now }),
      entry('skew', { publishedTs: now + 5 * 60000 }),
      entry('too-far', { publishedTs: now + 5 * 60000 + 1 }),
    ])).toEqual(['skew', 'now', 'earliest']);
  });

  it('does not invent dates from text or include missing, zero, negative, or invalid timestamps', () => {
    expect(ids([
      entry('missing', { publishedTs: undefined, published: new Date(now).toISOString() }),
      entry('null', { publishedTs: null }),
      entry('zero', { publishedTs: 0 }),
      entry('negative', { publishedTs: -1 }),
      entry('nan', { publishedTs: NaN }),
      entry('infinite', { publishedTs: Infinity }),
    ])).toEqual([]);
  });

  it('returns no recommendations for empty keywords or an invalid current time', () => {
    expect(ids([entry('a')], { keywords: ' ,；\n' })).toEqual([]);
    expect(buildResearchQueue([entry('a')], preferences, [], NaN)).toEqual([]);
  });

  it('ranks by distinct matching words, then date, then original order and explains matches', () => {
    const entries = [
      entry('new-one-word', { publishedTs: now }),
      entry('tie-first', { title: 'Agent Memory 长期规划', publishedTs: now - day }),
      entry('older-two-words', { title: 'Agent Memory 长期规划', publishedTs: now - 2 * day }),
      entry('tie-second', { title: 'Agent Memory 长期规划', publishedTs: now - day }),
      entry('repeated-word', { title: 'Agent Memory agent memory agent memory', publishedTs: now - day }),
    ];
    const result = buildResearchQueue(entries, { ...preferences, keywords: 'agent memory,长期规划,AGENT MEMORY' }, [], now);
    expect(result.map(item => item.entry.id)).toEqual(['tie-first', 'tie-second', 'older-two-words', 'new-one-word', 'repeated-word']);
    expect(result[0].matched).toEqual(['agent memory', '长期规划']);
    expect(result.at(-1)?.matched).toEqual(['agent memory']);
  });

  it('deduplicates article IDs before applying source and total quotas', () => {
    const entries = [
      entry('a', { sourceId: 'many', publishedTs: now }),
      entry('a', { sourceId: 'many', publishedTs: now - 1 }),
      entry('b', { sourceId: 'many', publishedTs: now - 2 }),
      entry('c', { sourceId: 'many', publishedTs: now - 3 }),
      entry('d', { sourceId: 'other', publishedTs: now - 4 }),
      entry('e', { sourceId: 'third', publishedTs: now - 5 }),
    ];
    expect(ids(entries, { perSource: 2, limit: 3 })).toEqual(['a', 'b', 'd']);
    expect(ids(entries, { perSource: 1, limit: 20 })).toEqual(['a', 'd', 'e']);
  });

  it('clamps numeric controls and safely defaults nonfinite values', () => {
    const many = Array.from({ length: 70 }, (_, i) => entry(String(i), { publishedTs: now - i }));
    expect(ids(many, { limit: 500, perSource: 500, days: 500 })).toHaveLength(50);
    expect(ids(many, { limit: -1, perSource: -1, days: -1 })).toHaveLength(1);
    expect(ids(many, { limit: Infinity, perSource: NaN, days: NaN })).toHaveLength(20);
    expect(ids(Array.from({ length: 10 }, (_, i) => entry(String(i), { sourceId: 'same' })), { perSource: 500 })).toHaveLength(5);
    expect(ids([entry('90days', { publishedTs: now - 90 * day }), entry('91days', { publishedTs: now - 91 * day })], { days: 500 }))
      .toEqual(['90days']);
    expect(ids([entry('recent', { publishedTs: now - day }), entry('old', { publishedTs: now - day - 1 })], { days: -1 }))
      .toEqual(['recent']);
  });

  it('preserves frozen input objects, arrays, preferences, and read IDs', () => {
    const first = Object.freeze(entry('a', { publishedTs: now - day }));
    const second = Object.freeze(entry('b', { title: 'Agent Memory 长期规划', publishedTs: now - 2 * day }));
    const entries = Object.freeze([first, second]);
    const config = Object.freeze({ ...preferences });
    const read = Object.freeze(['unrelated']);
    const before = JSON.stringify({ entries, config, read });
    const result = buildResearchQueue(entries, config, read, now);
    expect(result.map(item => item.entry.id)).toEqual(['b', 'a']);
    expect(result[0].entry).toBe(second);
    expect(JSON.stringify({ entries, config, read })).toBe(before);
  });
});

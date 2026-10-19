import type { Entry } from './model';

export type QueuePreferences = {
  keywords: string;
  exclude: string;
  days: number;
  limit: number;
  perSource: number;
};

export type QueueItem = { entry: Entry; matched: string[] };

export const researchTopics: readonly {
  id: 'memory' | 'workflow' | 'planning';
  name: string;
  keywords: string;
}[] = [
  {
    id: 'memory', name: '多智能体记忆',
    keywords: '多智能体记忆,智能体记忆,长期记忆,记忆机制,agent memory,multi-agent memory,memory consolidation,memory retrieval',
  },
  {
    id: 'workflow', name: 'Agent 工作流',
    keywords: 'Agent 工作流,智能体工作流,工作流编排,多智能体协作,agent workflow,multi-agent collaboration,agent orchestration,tool use',
  },
  {
    id: 'planning', name: '长期规划',
    keywords: '长期规划,长程规划,长时程任务,长期任务,long-horizon planning,long horizon planning,long-term planning,long-horizon task',
  },
];

/** Preserve the first spelling for the match explanation, while deduplicating case-insensitively. */
export function parseQueueKeywords(value: string): string[] {
  const words: string[] = [];
  const seen = new Set<string>();
  for (const part of value.split(/[,，;；\r\n]+/)) {
    const word = part.trim();
    if (!word || word.length > 80 || seen.has(word.toLowerCase())) continue;
    words.push(word);
    seen.add(word.toLowerCase());
    if (words.length === 50) break;
  }
  return words;
}

function boundedInteger(value: number, fallback: number, max: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.min(max, Math.floor(value))) : fallback;
}

/** Rank unread, recent literal matches without modifying entries or fetching article bodies. */
export function buildResearchQueue(
  entries: readonly Entry[], preferences: QueuePreferences, readIds: readonly string[], now = Date.now(),
): QueueItem[] {
  const words = parseQueueKeywords(preferences.keywords);
  if (!words.length || !Number.isFinite(now)) return [];
  const keywords = words.map(word => ({ word, normalized: word.toLowerCase() }));
  const excluded = parseQueueKeywords(preferences.exclude).map(word => word.toLowerCase());
  const days = boundedInteger(preferences.days, 7, 90);
  const limit = boundedInteger(preferences.limit, 20, 50);
  const perSource = boundedInteger(preferences.perSource, 3, 5);
  const earliest = now - days * 86400000;
  const latest = now + 5 * 60000;
  const read = new Set(readIds);
  const candidates: (QueueItem & { order: number; published: number })[] = [];

  entries.forEach((entry, order) => {
    const published = entry.publishedTs;
    if (read.has(entry.id) || !Number.isFinite(published) || published == null
      || published <= 0 || published < earliest || published > latest) return;
    const fields = [entry.title, entry.titleZh, entry.summary, entry.summaryZh]
      .map(value => (value || '').toLowerCase());
    if (excluded.some(word => fields.some(field => field.includes(word)))) return;
    const matched = keywords.filter(({ normalized }) => fields.some(field => field.includes(normalized)))
      .map(({ word }) => word);
    if (matched.length) candidates.push({ entry, matched, order, published });
  });

  candidates.sort((a, b) => b.matched.length - a.matched.length || b.published - a.published || a.order - b.order);
  const result: QueueItem[] = [];
  const seen = new Set<string>();
  const sourceCounts = new Map<string, number>();
  for (const { entry, matched } of candidates) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    const count = sourceCounts.get(entry.sourceId) || 0;
    if (count >= perSource) continue;
    result.push({ entry, matched });
    sourceCounts.set(entry.sourceId, count + 1);
    if (result.length === limit) break;
  }
  return result;
}

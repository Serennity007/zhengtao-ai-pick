import { describe, expect, it } from 'vitest';
import { feedUrl } from '../src/feeds';
import { researchPriorityGroups, researchSources } from '../src/research-sources';

describe('independent research source preset', () => {
  it('contains 23 unique public subscriptions with usable names, sites, and groups', () => {
    expect(researchSources).toHaveLength(23);
    expect(new Set(researchSources.map(source => source.legacyId)).size).toBe(23);
    expect(new Set(researchSources.map(source => feedUrl(source.url))).size).toBe(23);
    for (const source of researchSources) {
      expect(source.name.trim()).toBeTruthy();
      expect(source.group.trim()).toBeTruthy();
      expect(new URL(source.site).protocol).toBe('https:');
    }
  });

  it('places the three arXiv Agent research feeds in the first priority group', () => {
    const papers = researchSources.filter(source => source.legacyId.startsWith('arxiv-'));
    expect(papers.map(source => source.legacyId)).toEqual(['arxiv-cs-ma', 'arxiv-llm-agents', 'arxiv-agent-memory']);
    expect(papers.every(source => source.group === researchPriorityGroups[0])).toBe(true);
    expect(papers[2].url).toContain('agent%20memory');
  });
});

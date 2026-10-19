// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { domesticWechatSources, domesticWechatSourcesToAdd, findDomesticSubscription, DOMESTIC_WECHAT_GROUP } from '../src/domestic-wechat';
import { baseDiscovery, searchDiscovery } from '../src/discovery-library';
import { subscriptionSchema } from '../src/model';

describe('domestic WeChat selection', () => {
  it('offers the research selection offline before generic accounts, without duplicate mirrors', () => {
    const accounts = baseDiscovery().filter(source => source.kind === 'wechat');
    expect(accounts.slice(0, 3).map(source => source.name)).toEqual(['PaperWeekly', 'AINLP', '机器之心']);
    expect(accounts.filter(source => source.name === '新智元')).toHaveLength(1);
    expect(searchDiscovery(accounts, 'Agent').some(source => source.name === 'AI大模型应用实践')).toBe(true);
    for (const source of domesticWechatSources) {
      expect(source.id).toMatch(/^wechat-[a-f0-9]{40}$/);
      expect(source.url).toBe(`https://wechat2rss.bestblogs.dev/feed/${source.id.slice(7)}.xml`);
      expect(source.group).toBe(DOMESTIC_WECHAT_GROUP);
    }
    expect(new Set(domesticWechatSources.map(source => source.url)).size).toBe(9);
  });

  it('recognizes the verified old feed route without merging arbitrary same-name subscriptions', () => {
    const preset = domesticWechatSources.find(source => source.name === '新智元')!;
    const old = subscriptionSchema.parse({ id: 'keep-old-identity', url: preset.aliases[0], name: 'My custom title', group: 'My custom group' });
    expect(findDomesticSubscription([old], `${preset.url}#fragment`)).toBe(old);
    expect(domesticWechatSourcesToAdd([old]).some(source => source.id === preset.id)).toBe(false);
    const unrelated = { ...old, url: 'https://example.org/feed', name: preset.name };
    expect(findDomesticSubscription([unrelated], preset.url)).toBeUndefined();
    expect(domesticWechatSourcesToAdd([unrelated]).some(source => source.id === preset.id)).toBe(true);
  });

  it('ignores malformed legacy addresses instead of blocking all selected sources', () => {
    const malformed = subscriptionSchema.parse({ id: 'old', url: 'not-a-url', name: 'Legacy' });
    expect(domesticWechatSourcesToAdd([malformed])).toHaveLength(9);
  });
});

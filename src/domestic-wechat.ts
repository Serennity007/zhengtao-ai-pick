import { feedUrl, type FeedInput } from './feeds';
import type { Subscription } from './model';

export const DOMESTIC_WECHAT_GROUP = '国内公众号精选';
export interface DomesticWechatSource extends FeedInput {
  id: string;
  site: string;
  description: string;
  aliases: readonly string[];
}

/** Editorial account selection, not an automated ranking of individual articles.
 * Public BestBlogs feeds checked with the production RSS parser on 2026-10-19.
 */
export const domesticWechatSources: readonly DomesticWechatSource[] = [
  ['0120e999fc95e098c74bd5482a2a4c8407c42c38', 'PaperWeekly', '论文解读、顶会成果与强化学习方法。'],
  ['875df1d1a991bf9250ba9813e3148f58ef2240d4', 'AINLP', '自然语言处理、大模型训练与 Agent 技术。'],
  ['8d97af31b0de9e48da74558af128a4673d78c9a3', '机器之心', '前沿论文、模型评测与大模型系统研究。'],
  ['ab58feca07412e57049e5d8561439c3fb35783c2', 'AI大模型应用实践', 'Agent 协议、应用架构与工程实践。'],
  ['789e5fefb9cc2646ba7b680cb7a88378a34eb7a4', 'AI科技评论', '研究访谈、技术评论与大模型工程。'],
  ['ea0dd8bddfe4fbfb32eaa81a1e1b628d45e97a80', 'Datawhale', '开源学习、实践教程与科研社区。'],
  ['54001ca616dbc4b55d2b25d79d68a70191a0ddf4', 'PaperAgent', 'AI 论文、Agent 工具和研究动态。'],
  ['64b57d666259aee6bd097e76164e4a8371f0ad04', '夕小瑶科技说', '中文 AI 前沿资讯与研究趋势。'],
  ['e531a18b21c34cf787b83ab444eef659d7a980de', '新智元', 'AI 行业动态与研究新闻补充。'],
].map(([id, name, description]) => ({
  id: `wechat-${id}`, name, description, group: DOMESTIC_WECHAT_GROUP,
  url: `https://wechat2rss.bestblogs.dev/feed/${id}.xml`, site: 'https://mp.weixin.qq.com/',
  // Only a verified previous route is an alias. Equal display names alone do
  // not identify arbitrary custom subscriptions or their reading histories.
  aliases: name === '新智元' ? ['https://rss.t5t6.com/weread/MP_WXS_3271041950.xml'] : [],
}));

export function findDomesticSubscription(subscriptions: readonly Subscription[], rawUrl: string): Subscription | undefined {
  const url = feedUrl(rawUrl);
  const preset = domesticWechatSources.find(source => source.url === url || source.aliases.includes(url));
  const urls = new Set(preset ? [preset.url, ...preset.aliases] : [url]);
  return subscriptions.find(subscription => {
    try { return urls.has(feedUrl(subscription.url)); }
    catch { return false; }
  });
}

export function domesticWechatSourcesToAdd(subscriptions: readonly Subscription[]): DomesticWechatSource[] {
  return domesticWechatSources.filter(source => !findDomesticSubscription(subscriptions, source.url));
}

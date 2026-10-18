import type { FeedInput } from './feeds';

/** Public RSS addresses from the independent Zhengtao Picks reader. */
export interface ResearchSource extends FeedInput { legacyId: string; site: string }
export const researchPriorityGroups = ['多智能体与 Agent 记忆', 'Agent 研究与工程'] as const;

export const researchSources: readonly ResearchSource[] = [
  { legacyId: 'arxiv-cs-ma', name: 'arXiv cs.MA', url: 'https://export.arxiv.org/rss/cs.MA', site: 'https://arxiv.org/list/cs.MA/recent', group: researchPriorityGroups[0] },
  { legacyId: 'arxiv-llm-agents', name: 'arXiv: LLM Agents', url: 'https://export.arxiv.org/api/query?search_query=all:%22LLM%20agents%22&sortBy=submittedDate&sortOrder=descending&max_results=40', site: 'https://arxiv.org/list/cs.CL/recent', group: researchPriorityGroups[0] },
  { legacyId: 'arxiv-agent-memory', name: 'arXiv: Agent Memory', url: 'https://export.arxiv.org/api/query?search_query=all:%22agent%20memory%22&sortBy=submittedDate&sortOrder=descending&max_results=40', site: 'https://arxiv.org/list/cs.CL/recent', group: researchPriorityGroups[0] },
  { legacyId: 'zep', name: 'Zep Blog', url: 'https://www.getzep.com/blog/rss.xml', site: 'https://www.getzep.com/blog', group: researchPriorityGroups[0] },
  { legacyId: 'simon-willison', name: 'Simon Willison', url: 'https://simonwillison.net/atom/everything/', site: 'https://simonwillison.net', group: researchPriorityGroups[1] },
  { legacyId: 'lilian-weng', name: 'Lilian Weng', url: 'https://lilianweng.github.io/index.xml', site: 'https://lilianweng.github.io', group: researchPriorityGroups[1] },
  { legacyId: 'eugene-yan', name: 'Eugene Yan', url: 'https://eugeneyan.com/rss/', site: 'https://eugeneyan.com', group: researchPriorityGroups[1] },
  { legacyId: 'hamel-husain', name: 'Hamel Husain', url: 'https://hamel.dev/index.xml', site: 'https://hamel.dev', group: researchPriorityGroups[1] },
  { legacyId: 'ahead-of-ai', name: 'Ahead of AI', url: 'https://magazine.sebastianraschka.com/feed', site: 'https://magazine.sebastianraschka.com', group: researchPriorityGroups[1] },
  { legacyId: 'interconnects', name: 'Interconnects', url: 'https://www.interconnects.ai/feed', site: 'https://www.interconnects.ai', group: researchPriorityGroups[1] },
  { legacyId: 'latent-space', name: 'Latent Space', url: 'https://www.latent.space/feed', site: 'https://www.latent.space', group: researchPriorityGroups[1] },
  { legacyId: 'one-useful-thing', name: 'One Useful Thing', url: 'https://www.oneusefulthing.org/feed', site: 'https://www.oneusefulthing.org', group: researchPriorityGroups[1] },
  { legacyId: 'openai-news', name: 'OpenAI News', url: 'https://openai.com/news/rss.xml', site: 'https://openai.com/news', group: 'AI 官方与研究动态' },
  { legacyId: 'google-ai', name: 'Google AI Blog', url: 'https://blog.google/innovation-and-ai/technology/ai/rss/', site: 'https://blog.google/technology/ai', group: 'AI 官方与研究动态' },
  { legacyId: 'github-blog', name: 'GitHub Blog', url: 'https://github.blog/feed/', site: 'https://github.blog', group: 'AI 官方与研究动态' },
  { legacyId: 'msr', name: 'Microsoft Research', url: 'https://www.microsoft.com/en-us/research/feed/', site: 'https://www.microsoft.com/en-us/research/blog', group: 'AI 官方与研究动态' },
  { legacyId: 'bair', name: 'BAIR Blog', url: 'https://bair.berkeley.edu/blog/feed.xml', site: 'https://bair.berkeley.edu/blog', group: 'AI 官方与研究动态' },
  { legacyId: 'baoyu', name: '宝玉的分享', url: 'https://s.baoyu.io/feed.xml', site: 'https://baoyu.io', group: '中文 AI 与技术' },
  { legacyId: 'ruanyifeng', name: '阮一峰的网络日志', url: 'https://www.ruanyifeng.com/blog/atom.xml', site: 'https://www.ruanyifeng.com/blog', group: '中文 AI 与技术' },
  { legacyId: 'infoq-cn', name: 'InfoQ 中文', url: 'https://www.infoq.cn/feed', site: 'https://www.infoq.cn', group: '中文 AI 与技术' },
  { legacyId: 'qbitai', name: '量子位', url: 'https://www.qbitai.com/feed', site: 'https://www.qbitai.com', group: '中文 AI 与技术' },
  { legacyId: 'lesswrong', name: 'LessWrong', url: 'https://www.lesswrong.com/feed.xml', site: 'https://www.lesswrong.com', group: 'AI 社区与安全' },
  { legacyId: 'lobsters-ai', name: 'Lobsters AI', url: 'https://lobste.rs/t/ai.rss', site: 'https://lobste.rs/t/ai', group: 'AI 社区与安全' },
];

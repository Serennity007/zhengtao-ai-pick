# 国内公众号精选

1.4.0 增加 9 个中文 AI／科研公众号。优先选择论文解读、Agent 工程及学习实践，资讯账号作为补充。这里的「精选」指账号选择；没有自动给文章评分、摘要或过滤广告，阅读时仍需判断论据与原论文。

## 账号与方向

| 账号 | 选择方向 | 公开 RSS |
| --- | --- | --- |
| PaperWeekly | 论文解读、顶会成果与强化学习 | [订阅](https://wechat2rss.bestblogs.dev/feed/0120e999fc95e098c74bd5482a2a4c8407c42c38.xml) |
| AINLP | NLP、大模型训练和 Agent 技术 | [订阅](https://wechat2rss.bestblogs.dev/feed/875df1d1a991bf9250ba9813e3148f58ef2240d4.xml) |
| 机器之心 | 前沿论文、评测与模型系统研究 | [订阅](https://wechat2rss.bestblogs.dev/feed/8d97af31b0de9e48da74558af128a4673d78c9a3.xml) |
| AI大模型应用实践 | Agent 协议、架构与应用工程 | [订阅](https://wechat2rss.bestblogs.dev/feed/ab58feca07412e57049e5d8561439c3fb35783c2.xml) |
| AI科技评论 | 研究访谈、技术评论与大模型工程 | [订阅](https://wechat2rss.bestblogs.dev/feed/789e5fefb9cc2646ba7b680cb7a88378a34eb7a4.xml) |
| Datawhale | 开源学习、实践教程与科研社区 | [订阅](https://wechat2rss.bestblogs.dev/feed/ea0dd8bddfe4fbfb32eaa81a1e1b628d45e97a80.xml) |
| PaperAgent | AI 论文、Agent 工具与研究动态 | [订阅](https://wechat2rss.bestblogs.dev/feed/54001ca616dbc4b55d2b25d79d68a70191a0ddf4.xml) |
| 夕小瑶科技说 | 中文 AI 前沿资讯与研究趋势 | [订阅](https://wechat2rss.bestblogs.dev/feed/64b57d666259aee6bd097e76164e4a8371f0ad04.xml) |
| 新智元 | AI 行业动态与研究新闻补充 | [订阅](https://wechat2rss.bestblogs.dev/feed/e531a18b21c34cf787b83ab444eef659d7a980de.xml) |

RSS 来自 [BestBlogs 的公开公众号订阅整理](https://www.bestblogs.dev/article/812c610e)，属于第三方订阅服务，保留微信原文链接。阅读文章时可以打开原文。

## 添加与数据保留

- 首次安装在科研预设之外加入这 9 个账号，分组名为「国内公众号精选」。
- 已有版本升级后，打开「探索订阅」并点击「添加国内精选」，或使用命令「正涛精选：添加国内公众号精选」。
- 已订阅的地址跳过；新智元已知的旧服务地址也识别为同一个账号。原 ID、自定义名称、分组、缓存、已读及收藏保留。
- 升级和重新启动不自动重加删除的来源。再次明确执行添加才会补回缺失账号。
- 离线可查看内置精选目录和添加订阅地址；获取文章需要联网。原有置顶与频道排序保持原样，新增分组位于「我的订阅」。

## 2026-10-19 实测

9 个源均返回 HTTP 200，通过严格 XML 解析及生产 `src/feeds.ts::parseFeed`。每源 10 条均保留，共 90 条；最新文章日期为 2026-10-12 至 2026-10-18。单个 RSS 小于 5 MiB，解析后单源缓存小于 1 MiB。

现有单篇 HTML 缓存上限为 100,000 字符。PaperWeekly、AI大模型应用实践、AI科技评论和 Datawhale 的部分长文触及该上限，因此本地正文可能不完整，需打开原文继续阅读。条目数与首篇正文可读不代表所有文章均完整或学术质量都已核验。服务后续的更新速度、内容和可用性由对应提供方决定。

本地 `npm run check` 通过：32 个测试文件、246 项插件测试、8 项服务端测试，TypeScript 与构建通过；ESLint 0 错误、7 条既有警告。桌面实测批量新增 9 个源并获取 90 条文章；原有 24 个订阅的 ID、地址、名称与分组及原已读记录均保留。公众号文章正文、图片和原文入口正常显示，重复点击添加返回 0 个，升级后安装三件套与构建一致。

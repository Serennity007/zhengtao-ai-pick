# 正涛精选的独立化与整合

正涛精选 1.3.0 基于 [joeseesun/qiaomu-ai-rss](https://github.com/joeseesun/qiaomu-ai-rss) 的完整阅读器引擎，加入本地独立版的 23 个科研订阅源。上游作者为向阳乔木，fork 基线为 `f9ebc163`，许可证为 **GPL-3.0-only**。

## 独立插件身份

| 项目 | 整合版 |
| --- | --- |
| 名称 | 正涛精选 |
| 插件 ID | `zhengtao-ai-pick` |
| 当前版本 | `1.4.0` |
| 安装目录 | `<库>/.obsidian/plugins/zhengtao-ai-pick/` |
| 新文章回链 | `obsidian://zhengtao-ai-pick` |

此前 fork 保留 `qiaomu-ai-rss` ID，并通过覆盖上游插件复用数据。1.3.0 使用独立 ID、视图与回链，不再覆盖乔木插件。上游署名用于说明来源；本项目的维护与安装入口指向 [Serennity007/zhengtao-ai-pick](https://github.com/Serennity007/zhengtao-ai-pick)。

旧笔记中的 URI 保持原样。原 `qiaomu-ai-rss` 协议仍由原乔木插件处理，新版不接管该协议。

## 整合内容

- 保留完整引擎的 RSS / Atom、分组、探索目录、收藏、已读、正文缓存、摘录、日记、笔记归档、桌面导出及本地 Markdown 阅读。
- 内置 23 个公开科研源，初装置顶「多智能体与 Agent 记忆」「Agent 研究与工程」。
- 通过 `createIntegratedState()` 一次性迁移可用的旧阅读器状态，保留订阅、已读、收藏和文章快照；不复制管理员、邀请码与收录服务凭据。
- 修复第 51 个置顶导致旧数据无法加载、重命名合并丢失置顶、别名合并留下失效置顶的问题。加载旧列表时过滤无效 ID、去重并保留前 50 个有效置顶。

科研源提供主题聚合。个人 RSS 使用原文，远程 AI 版本取决于服务已有内容；整合版未加入独立模型生成、论文评分或自动选题算法。

## 构建、安装和回滚

```sh
npm ci
npm run check
```

将 `main.js`、`manifest.json`、`styles.css` 安装到 `plugins/zhengtao-ai-pick/`。1.4.0 增加 9 个国内公众号精选及去重批量添加入口，源码可自行构建；尚未发布远端 Release 或上架社区插件目录。

迁移保留旧数据。回滚时关闭新插件，重新启用旧版；新版产生的数据不回写旧版。详细数据范围见 [整合说明](docs/INTEGRATION-1.3.0.md)。个人插件数据和备份只留在本地，不加入源码或发布包。

## 许可证与上游关系

`LICENSE`、上游版权声明、历史许可和第三方声明继续保留。独立插件身份不改变上游代码及第三方内容的版权归属。分发本项目及修改版须遵守 GPL-3.0-only，并提供相应源码与许可声明；本项目不代表上游运营方。

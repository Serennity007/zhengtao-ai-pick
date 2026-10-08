# 本 fork 改了什么

上游：[joeseesun/qiaomu-ai-rss](https://github.com/joeseesun/qiaomu-ai-rss) · GPL-3.0-only · 作者 向阳乔木
基线提交：`f9ebc163`（v0.26.2 发布后再领先 9 个提交，含上游的 Atom 命名空间解析修复）

## 功能：把订阅分组置顶为顶层频道

官方版的频道菜单段落顺序是写死的：`乔木精选 → 读者社区 → 我的订阅`，而用户自建分组（`订阅分组`）只能渲染在「我的订阅」标题**之后**。本 fork 增加一个开关，让任意分组成为与上述三者并列的顶层段落。

用法：库视图（订阅管理）→ 分组右侧的菜单 → **置顶为独立频道** / **取消置顶**。

置顶后的效果：

- 该分组自己一个段落标题（用分组名），下面就是它那一行，仍可展开列出组内订阅
- 不再重复出现在「我的订阅」段落里
- 进入该频道时的面包屑显示分组名，而不是「我的订阅」（未置顶的分组行为不变）

## 改动清单

| 文件 | 改动 |
| --- | --- |
| `src/model.ts` | `settings.pinnedGroupIds: string[]`（zod schema + 默认值），上限 50 个、单个 120 字符 |
| `src/personal-library.ts` | 新增 `togglePinnedGroup()`；`deleteGroup()` 顺带清掉已删除分组的置顶项，避免留下失效 id |
| `src/channel-picker.ts` | 构造参数新增 `pinnedGroups`；新增 `isPinned()`；`render()` 在「我的订阅」标题前渲染置顶段落并从原列表排除；`where()` 让置顶分组显示自己的名字 |
| `src/view.ts` | 构造 `ChannelPicker` 时传入 `settings.pinnedGroupIds` |
| `src/library-view.ts` | 分组菜单新增置顶/取消置顶项（图标 `pin` / `pin-off`） |
| `src/i18n.ts` | 新增 `library.pinGroup`、`library.unpinGroup` 两行，八语齐全 |
| `tests/personal-library.test.ts` | 3 条新测试：双向切换、删除分组后不留失效 id、旧状态缺字段时取 schema 默认值 |
| `manifest.json` / `package.json` / `versions.json` | 显示名 `Zhengtao AI Pick`、版本 `1.0.0`；**`id` 保持 `qiaomu-ai-rss`** |

`id` 不变是刻意的：这样构建产物可以直接覆盖官方插件所在目录，沿用你已有的 `data.json`（订阅、已读、收藏都不用迁移）。代价是内部 id 仍写着 qiaomu。

## 构建与安装

```bash
npm ci
npm run check      # eslint + vitest + tsc --noEmit + esbuild 打包 main.js
```

产物 `main.js`（约 4.6 MB，含内嵌字体与许可证 banner）+ `manifest.json` + `styles.css`，放进
`<库>/.obsidian/plugins/qiaomu-ai-rss/` 覆盖官方版本即可。注意 `main.js` 在上游 `.gitignore` 里，仓库只有源码。

## 跟踪上游

```bash
git remote add upstream https://github.com/joeseesun/qiaomu-ai-rss.git
git fetch upstream && git rebase upstream/main
```

冲突大概率只出现在 `src/channel-picker.ts` 的 `render()` 尾部和 `src/model.ts` 的 settings 段——这两处上游自己也在动。

## 许可证

沿用上游 **GPL-3.0-only**：`LICENSE` 未改动，上游的 `COMMERCIAL-LICENSE.md`、`THIRD_PARTY_NOTICES.md`、`LICENSES/` 全部保留；构建 banner 里的 向阳乔木 版权声明与字体/目录许可证同样保留。任何再分发都必须继续以 GPL 提供源码。

# opml-portability-report

Offline OPML migration reports. Surface FreshRSS extensions and reader-specific source types, then compare a round-trip export for missing feeds, category changes and lost attributes.

换 RSS 阅读器前，先看哪些订阅配置依赖原阅读器；导入新阅读器后，把它再次导出的 OPML 与原文件比较，检查订阅、分类和扩展信息是否丢失。

## 为什么做这个 / Why this exists

现有阅读器负责订阅与导入，本工具提供**迁移前后的独立审阅报告**。OPML 可以携带阅读器扩展；例如 FreshRSS 定义 XPath/JSON 来源、动态 OPML、过滤与其他 `frss:` 属性。目标阅读器能导入订阅 URL，并不自动意味着这些行为也完整保留。[FreshRSS 官方扩展文档](https://github.com/FreshRSS/FreshRSS/blob/edge/docs/en/developers/OPML.md)

XML 解析直接使用成熟的 [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser)，本项目只做 OPML 迁移语义检查。它是独立配套工具，不是 FreshRSS 的 fork 或官方认证迁移器，不宣称市场上没有其他 OPML 工具。

## 快速开始

需要 Node.js 22 或更新版本。

```sh
git clone https://github.com/DrEli7/opml-portability-report.git
cd opml-portability-report
npm ci --ignore-scripts --registry=https://registry.npmjs.org
npm test
npm run demo
```

examples 中完全是合成数据和 `example.org/.net` URL。示例故意模拟迁移后丢失一个抓取订阅、一个优先级属性，并把分类展平。

```sh
# 迁移前审阅
node src/cli.mjs before.opml

# 新阅读器导入后，再导出 after.opml 做比较
node src/cli.mjs before.opml --after after.opml --format json

# 警告也阻止 CI 继续
node src/cli.mjs before.opml --after after.opml --fail-on warning

# 保存 Markdown 报告；报告路径不要与输入相同
node src/cli.mjs before.opml --format markdown > migration-report.md
```

CLI 只读输入、向 stdout 输出，不访问订阅 URL，不导入、不改写 OPML。安装依赖需要 npm 网络访问，生成报告完全离线。报告省略 feed URL 与扩展属性的值，保留分类名称、属性名称、outline 编号；仍应审阅后再公开分享。

## 参数与退出码

| 参数 | 用途 |
| --- | --- |
| `INPUT.opml` | 恰好一个迁移前 OPML 文件 |
| `--after FILE` | 可选，目标阅读器的回导文件 |
| `--format markdown\|json` | 默认 markdown |
| `--fail-on error\|warning\|never` | 默认 error；warning 将警告也视作失败 |
| `--help` | 显示帮助 |

`0`：未达到所选问题阈值。`1`：报告存在达到阈值的问题。`2`：参数、文件、编码或 XML 错误。未知/重复参数会拒绝。

## 检查范围

| 检查 | 发现什么 |
| --- | --- |
| 完整性 | 缺失 outline text、无效 HTTP(S) xmlUrl、RSS 叶节点缺失 xmlUrl |
| 订阅重复 | 同一规范化 URL 出现多次，给出对应 outline 编号 |
| 阅读器扩展 | `frss:*` 及其他非标准属性名、非 rss 来源类型 |
| 分类 | 完整分类路径、嵌套分类、同时有子项的 feed |
| `--after` | 缺失/新增唯一 feed、分类路径或标准 category 属性改变、类型或扩展属性改变/丢失 |

outline 编号按源文件深度优先顺序，从 1 开始。URL 使用标准 `URL` 规范化（如主机大小写、默认端口），保留 query 和 fragment；不会擅自去掉跟踪参数，也不把 HTTP/HTTPS 当作相同。重复 URL 对应多个源或目标条目时，报告 `AMBIGUOUS_ROUNDTRIP`，不猜测分类/属性对应关系。

`extensionLosses` 是类型或扩展属性变化的**属性个数**，并非订阅个数。`movedFeeds` 同时计入分类路径和标准 `category` 属性变化。warning 表示可能的兼容性风险，并不证明某一个具体目标阅读器必然不支持该功能。

## 边界

支持 UTF-8、最大 20 MiB、根元素为无前缀 `<opml>` 的文档；最多 100,000 个 outline，嵌套受解析库及本工具的 100 层保护限制。拒绝 DTD/DOCTYPE 与自定义实体，不加载外部资源。支持常规 XML 预定义实体。

不会验证远程 feed 是否可访问，不检查文章、已读状态、标签数据库、认证是否有效，也不做阅读器备份。`--after` 只比较唯一 HTTP(S) feed URL 及上述元数据；不比较 feed 显示名称、描述、head 元数据、空文件夹、outline 顺序、FreshRSS 动态列表的展开结果。扩展名字空间前缀发生变化也会报告属性变化，报告不会尝试证明语义等价。请保留原阅读器的完整备份。

## JavaScript API

```js
import { auditOpml, toMarkdown } from './src/index.mjs';

const before = '<opml version="2.0"><body><outline text="Demo" type="rss" xmlUrl="https://example.org/feed"/></body></opml>';
const after = '<opml version="2.0"><body/></opml>';
const report = auditOpml(before, { afterXml: after });
console.log(report.comparison.missingFeeds); // 1
console.log(toMarkdown(report));
```

核心函数没有文件 I/O。JSON 报告包含 `schemaVersion: 1`，未来可能添加字段。

## 开发与许可

```sh
npm test
```

测试覆盖 FreshRSS 扩展、URL 规范化、重复歧义、迁移丢失、分类属性、无效 XML/实体、Markdown 转义及真实 CLI 子进程、UTF-8 和输入不变检查。CI 配置覆盖 Ubuntu/Windows、Node 22/24。MIT © 2026 DrEli7。见 [CONTRIBUTING.md](CONTRIBUTING.md)。

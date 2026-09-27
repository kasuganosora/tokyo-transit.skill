# ODPT API 要点笔记

> 来源：上游 n1 匿名探查（20 请求实测 + developer.odpt.org SPA bundle 文档抽取），
> 经 n2 于 2026-09-27 沙箱复测关键行（403 语义 / 编码形式 / Node 原生 fetch）。
> 原稿落在 /tmp/tt-notes/odpt-api.md，因沙箱 /tmp 跨工具不可靠（write_file 报 success 但
> exec 视图丢失）而消失，本文件为 /data 可靠路径下的重建版，仅收录已验证事实。
> 原始抽取证据：/tmp/tt-notes/bundle_extract_part1.txt、part2.txt、probe_raw.tsv（/tmp 易失）。

## 鉴权

- 仅支持 query 参数 `acl:consumerKey`；无 header 方式。
- 无 key → 403 `Require acl:consumerKey.`；坏 key → 403 `Invalid acl:consumerKey.`（复测一致）。
- 不存在匿名可用数据端点：`/api/v4/` 下所有资源均要求 key。
- 403 响应体为 `text/html` 纯文本（非 JSON）；网关 Kong 0.11.2 + Express；仅 GET（OPTIONS → 404）。

## 端点（`https://api.odpt.org/api/v4/`）

| 资源 | 用途 |
|---|---|
| `odpt:Operator` | 事業者（東京メトロ/都営/JR东日本等） |
| `odpt:Railway` | 路线 |
| `odpt:Station` | 车站 |
| `odpt:TrainTimetable` | 列车时刻表 |
| `odpt:StationTimetable` | 车站时刻表 |
| `odpt:TrainLocation` | 列车实时位置 |
| `places` | 地点检索 |

路径中 `odpt:` 前缀用原样冒号或 `%3A` 均可，网关正常解析（复测一致）。

## 过滤参数（query 透传）

`odpt:operator` / `odpt:railway` / `odpt:station` / `dc:title` / `odpt:stationTitle.en` / `limit`
谓词值支持逗号 OR（如 `dc:title=東京,五反田`）。

## 字段速查（bundle 文档原文核实）

- `@id`（urn:odpt:...）、`dc:title`
- 多语言标题对象：`odpt:stationTitle` / `odpt:railwayTitle` / `odpt:operatorTitle`，形如 `{"ja":..,"en":..}`
- 坐标：`geo:lat` / `geo:long`
- 关联：`odpt:operator` / `odpt:railway` / `odpt:connectingRailway` / `odpt:stationCode` / `odpt:lineCode`
- 列车：`odpt:trainNumber` / `odpt:originStation` / `odpt:destinationStation` / `odpt:fromStation` / `odpt:toStation` / `odpt:delay`
- 时刻表明细为对象数组：`odpt:trainTimetableObject` / `odpt:stationTimetableObject`

## limit 语义

`limit` 是系统输出上限的截断保护（文档原文 "the result truncated below the upper limit is
returned"），**不是分页**：无 offset/page 参数，官方要求用谓词收窄。FAQ 锚点 `#api-output-limit`。

## 限流（`X-RateLimit-*` 响应头，含 Remaining）

60 次/分 · 3600 次/时 · 24000 次/日。

## 版本与注册

- API `v4`；API 仕様文档 4.16（上游曾误写 2026-04-03，以更正值 2026-09-03 为准）。
- 注册（免费）：https://developer.odpt.org → Sign up（@odpt.org 邮件放行）→ 右上 "Access token" 查 PRIMARY/SECONDARY key。
- 咨询：info@odpt.org

## 配套工具

`scripts/odpt_query.js`（本目录上一级，零依赖 Node ≥18，原生 fetch）：
`node scripts/odpt_query.js <资源类型> [键=值...] [--limit N] [--full] [--json]`；
密钥取 `ODPT_API_KEY` 环境变量 → `/data/secrets/odpt.env`（权限 600，
`set -a; . /data/secrets/odpt.env; set +a`）。

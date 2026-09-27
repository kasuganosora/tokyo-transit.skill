---
name: tokyo-transit
description: 当用户查询日本（尤其东京）公共交通数据时使用，包含但不限于：电车、地铁、Metro、JR、公交/巴士、车站信息、线路信息、运营者、列车时刻表、车站时刻表、列车实时位置、运营信息等场景，自动触发此技能。注意：本技能仅提供 ODPT 原始数据查询，不支持换乘规划。
version: 1.0.0
homepage: https://developer.odpt.org/
metadata:
  openclaw:
    requires:
      bins:
        - node
      env:
        - ODPT_API_KEY
      primaryEnv: ODPT_API_KEY
    homepage: https://developer.odpt.org/
---

# 东京公共交通数据查询 Skill（tokyo-transit）

基于日本公共交通开放数据中心（ODPT）官方 API，查询东京及日本主要城市的车站、线路、运营者、时刻表、列车实时位置等**原始数据**。

## 一、适用场景

- **适用**：日本公共交通**原始数据**查询，尤其东京——
  - 车站：名称（日/英多语言）、坐标、车站编号、可换乘线路（如「新宿站有哪些线路」「东京站的坐标」）
  - 线路：线路列表、线路走向与站序（如「东京Metro 东西线经过哪些站」）
  - 运营者：东京Metro、JR东日本、都营交通、小田急等运营者清单
  - 时刻表：列车时刻表 / 车站时刻表（如「中野站今天的时刻表」）
  - 列车实时位置：当前在线列车的位置与延误（如「东西线现在列车在哪」）
  - 地理检索：按坐标半径查周边车站
- **不适用（重要）**：**本技能不支持换乘规划**（"从 A 站到 B 站怎么坐""最快路线""票价计算"等均无法完成）。ODPT 只提供静态/实时原始数据，无路径规划接口。此类请求请明确告知用户能力边界，勿用通用知识臆造线路方案；可退而提供两站各自的线路/时刻原始数据供用户自行判断。

## 二、数据源说明

| 项目 | 值 |
|------|----|
| 数据源 | 公共交通开放数据中心（ODPT），https://odpt.org |
| API 基址 | `https://api.odpt.org/api/v4/` |
| 鉴权 | **所有数据端点均需 query 参数 `acl:consumerKey`**；匿名访问一律返回 `403 Require acl:consumerKey.`，无效 key 返回 `403 Invalid acl:consumerKey.`。**不存在匿名可用的数据端点** |
| 传参方式 | 仅 query 参数 `?acl:consumerKey=...`（无 header / Bearer 方式） |
| HTTP 方法 | 仅 GET |
| token 注册 | https://developer.odpt.org → Sign up（免费，email 注册，需放行 `@odpt.org` 域邮件）→ 登录后右上 "Access token" 查看 PRIMARY / SECONDARY key；咨询 info@odpt.org |
| API 版本 | `api/v4`（API 仕様文档 4.16） |
| 限流 | 60 次/分 · 3600 次/时 · 24000 次/日（响应头 `X-RateLimit-*` 含剩余额度） |

常用数据端点（资源类型）：`odpt:Operator`（运营者）、`odpt:Station`（车站）、`odpt:Railway`（线路）、`odpt:TrainTimetable`（列车时刻表）、`odpt:StationTimetable`（车站时刻表）、`odpt:TrainLocation`（列车实时位置）、`places`（地理检索）。

## 三、密钥配置

**执行前，先确定 token（按优先级）：**

0. **本沙箱已预配置**：密钥存放在 `/data/secrets/odpt.env`（权限 600，不入 git），内容形如 `ODPT_API_KEY=xxx`。执行脚本前先加载：`set -a; . /data/secrets/odpt.env; set +a`，之后 `process.env.ODPT_API_KEY` 即可用。**不要把密钥内容输出到对话或文件里。**
1. 若上述文件不存在但环境中已设置 `ODPT_API_KEY` 环境变量，直接使用该值。
2. 两者都缺失时：**不要伪造密钥、不要反复空跑**。指引用户按上文注册地址自行注册获取 key，配置到 `/data/secrets/odpt.env` 或环境变量后再执行。

两种方式均通过 `process.env.ODPT_API_KEY` 读取，任何情况下都**不回显、不落盘打印密钥内容**。

## 四、脚本用法

在技能目录下执行（须先完成密钥配置第 0 步加载环境）：

```bash
# 通用查询：资源类型 + 任意过滤参数（谓词=值）+ --limit
node scripts/odpt_query.js odpt:Station odpt:operator=odpt.Operator:TokyoMetro --limit 5

# 按站名快捷查车站（支持日文/英文站名，自动模糊匹配）
node scripts/odpt_station.js 新宿
```

### 常用资源类型与过滤参数

| 资源类型 | 说明 | 典型过滤参数 |
|----------|------|--------------|
| `odpt:Operator` | 运营者（东京Metro、JR东日本等） | `dc:title` |
| `odpt:Station` | 车站 | `odpt:operator`、`odpt:railway`、`dc:title`、`odpt:stationTitle.en` |
| `odpt:Railway` | 线路 | `odpt:operator` |
| `odpt:TrainTimetable` | 列车时刻表（**数据量大**） | `odpt:railway`、`odpt:operator`（**必加**） |
| `odpt:StationTimetable` | 车站时刻表（**数据量大**） | `odpt:station`、`odpt:operator`（**必加**） |
| `odpt:TrainLocation` | 列车实时位置 | `odpt:operator`、`odpt:railway` |

过滤参数取值形式：

```bash
node scripts/odpt_query.js odpt:Station odpt:operator=odpt.Operator:TokyoMetro --limit 5
node scripts/odpt_query.js odpt:Station odpt:railway=odpt.Railway:TokyoMetro.Tozai --limit 5
node scripts/odpt_query.js odpt:StationTimetable odpt:station=odpt.Station:TokyoMetro.Tozai.Nakano --limit 3
node scripts/odpt_query.js odpt:Station dc:title=東京,五反田 --limit 10   # 逗号 = OR
```

### 输出选项

| 选项 | 说明 |
|------|------|
| （默认） | 输出**精简字段**（站名、ID、坐标、线路/运营者等关键字段），便于快速阅读 |
| `--full` | 输出完整解析字段 |
| `--json` | 原样输出 API 返回的完整 JSON（排障或需全部字段时用） |
| `--limit N` | 限制返回条数（截断保护，**非分页**；API 无 offset/page 参数） |

## 五、注意事项

1. **无换乘规划能力**：再次强调，"怎么坐车/最优路线/票价"类请求不做路径规划，只提供原始数据。
2. **时刻表类数据量大，务必加过滤**：`odpt:TrainTimetable` / `odpt:StationTimetable` 全量拉取会被系统上限自动截断（`limit` 是截断保护而非分页游标，无 offset/page），必须用 `odpt:railway` / `odpt:operator` / `odpt:station` 收窄后再查。
3. **字段名带 `odpt:` 前缀**（DC/Geo 命名空间同理）：如 `odpt:stationTitle` 是多语言对象 `{"ja":"東京","en":"Tokyo"}`（可下钻过滤 `odpt:stationTitle.en=Tokyo`）；坐标为 `geo:lat` / `geo:long`；引用 ID 用 `owl:sameAs` 形如 `odpt.Station:TokyoMetro.Ginza.Ueno`。拼命令时谓词与值都要原样带前缀。
4. **脚本默认输出精简字段**：需要完整字段时用 `--full`，需要原始 JSON 时用 `--json`。
5. **限流与配额**：60 次/分 · 3600 次/时 · 24000 次/日；批量查询注意节奏，可从响应头 `X-RateLimit-Remaining-*` 观察剩余额度。
6. 403 错误（`Require`/`Invalid acl:consumerKey.`）即密钥缺失或错误，回到密钥配置一节排查，勿盲目重试消耗配额。

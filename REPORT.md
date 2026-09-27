# tokyo-transit 技能交付报告

> 汇总人：技术项目经理（主控）｜日期：2026-09-27｜范围：`/data/skills/tokyo-transit`
> 素材：`/tmp/tt-notes/{odpt-api.md, clawhub.md, test-report.md, publish-report.md}` + 实际文件树与各文件行数
> 红线遵守：本报告不含任何真实密钥值（仅在环境内以存在性/权限形式提及）；未修改本目录以外的任何目录；本目录内无杂物文件，无需清理。

---

## 一、技能文件清单

实际文件树（`ls -laR /data/skills/tokyo-transit`，含行数 `wc -l`）：

| 路径 | 行数 | 大小 | 用途 |
|---|---:|---:|---|
| `SKILL.md` | 102 | 6980B | 技能定义与完整用法（代理主入口）：适用/不适用场景（**不支持换乘规划**）、数据源与鉴权表、密钥配置三级策略、脚本用法、过滤参数表、注意事项 |
| `README.md` | 52 | 1716B | 项目简介、快速开始（密钥加载两步）、token 注册指引、目录结构 |
| `references/odpt-api-notes.md` | 64 | 3175B | ODPT API 要点参考：端点表、过滤参数、字段速查、limit 语义、限流、版本与注册 |
| `scripts/odpt_query.js` | 377 | 17525B | 通用查询 CLI（零依赖 Node≥18 原生 fetch）：`<资源类型> [键=值...] [--limit/--full/--json]` |
| `scripts/odpt_station.js` | 544 | 23785B | 按站名多语言检索 CLI：不指定运营者时先取运营公司列表再逐家 fan-out（规避服务端截断）；退出码 0/1/2 语义 |
| `scripts/test_odpt_station.js` | 282 | 16246B | 端到端自测（mock 全局 fetch，无需网络与真实密钥）：32 项断言 |
| **合计** | **1421** | — | 6 个文件；无 `node_modules`、无日志/临时杂物；无 `.clawhub/`、`_meta.json`、`skill-card.md`（本地手写型，从未安装/发布过） |

---

## 二、测试结果汇总表

测试环境：Node v22.23.2（原生 fetch）；QA 执行时 `ODPT_API_KEY` 未设置且 `/data/secrets/odpt.env` 不存在（**主控复核时该文件仍不存在、环境变量仍为空**），故带真实 key 实测项为 N/A，以匿名 403 实测 + 显式假值 403 Invalid + mock 200 路径组合覆盖。

### 2.1 静态与参数类

| # | 测试项 | 命令 | 预期 | 实际 | 结果 |
|---|---|---|---|---|---|
| 1 | 语法检查 | `node --check scripts/{odpt_query,odpt_station,test_odpt_station}.js` | 退出 0 | 3 个文件均退出 0 | ✅ PASS |
| 2 | 无参运行 | `node scripts/odpt_query.js` / `odpt_station.js` | 非零退出 + usage（stderr） | 退出 2 + 完整 usage，无未捕获异常 | ✅ PASS |
| 3 | 帮助 | `odpt_query.js -h` / `odpt_station.js -h` | 退出 0 + stdout 帮助 | 退出 0，stdout 1621B / 完整帮助 | ✅ PASS |
| 4 | 参数错误矩阵 | `--limit 0 / -1 / abc / 缺值`、非 `k=v` 过滤条件、`--bogus`、多余位置参数 | 退出 2 + stderr 明确提示 | 全部退出 2，错误走 stderr | ✅ PASS |

### 2.2 匿名实测（真实请求 ODPT 网关）

| # | 测试项 | 命令 | 预期 | 实际 | 结果 |
|---|---|---|---|---|---|
| 5 | 通用查询无 key | `node scripts/odpt_query.js odpt:Station odpt:operator=odpt.Operator:TokyoMetro --limit 3` | 发真实请求 → 403 `Require acl:consumerKey.` + 指引 + 退出 1 | HTTP 403，`Require acl:consumerKey.`，4 步配置指引，退出 1，stdout 空，URL 不含密钥 | ✅ PASS |
| 6 | 站名检索无 key（修复后） | `node scripts/odpt_station.js 新宿` | 同上 | HTTP 403 `Require acl:consumerKey.` + 注册/配置指引 + 限流余量（24000/日·3600/时·60/分）+ 退出 1 | ✅ PASS（修复后） |
| 7 | 网关编码探针（curl/python） | 路径原始冒号 / 全编码 / 中文编码 / 中文原始 UTF-8 / 不存在资源 `odpt%3ANope` | 403（鉴权先于资源校验） | 5 种形态全部 403 `Require acl:consumerKey.` | ✅ PASS |

> **BUG①（已修复）**：`odpt_station.js` 原实现无 key 时本地短路（零网络请求、退出 2），与"发出真实请求由网关 403 兜底"契约不符；且 `apiGet` 无条件 set 密钥参数，key 缺失时会把字面量 `"null"` 当密钥发出（网关报 `Invalid` 误导排障）。修复 7 处编辑（无 key 不附密钥参数、删除本地短路、403 Require 分支补完整指引、退出码口径统一 1=请求失败/2=参数错误）。修复后复测 PASS。

### 2.3 假值 key（403 Invalid 分支，密钥加载链路验证）

| # | 测试项 | 命令 | 预期 | 实际 | 结果 |
|---|---|---|---|---|---|
| 8 | 通用查询坏 key | `ODPT_API_KEY=<假值> node scripts/odpt_query.js odpt:Railway --limit 2` | 403 `Invalid acl:consumerKey.` + 令牌无效提示 | 403 `Invalid acl:consumerKey.` + 指引，退出 1 | ✅ PASS |
| 9 | 站名检索坏 key | `ODPT_API_KEY=<假值> node scripts/odpt_station.js shinjuku --operator TokyoMetro` | 同上 | 403 `Invalid` + PRIMARY/SECONDARY 提示 + 限流余量，退出 1 | ✅ PASS |
| — | 泄漏检查 | 对 stdout/stderr grep 假值标记 | 0 次 | 0 次 | ✅ PASS |

### 2.4 mock 端到端与纯函数

| # | 测试项 | 命令 | 预期 | 实际 | 结果 |
|---|---|---|---|---|---|
| 10 | 单元/端到端自测 | `node scripts/test_odpt_station.js`（mock fetch，无需网络与真实密钥） | 全绿 | **32 通过 / 0 失败**（修复前基线 29；含新增回归：缺 key 仍发真实请求且 URL 不带密钥参数；fan-out 凑够 `--limit` 提前收手） | ✅ PASS |
| 11 | URL 构造不变量 | `buildUrl` 等纯函数（14 项） | 冒号/中文/逗号 OR 正确编码；无 key 不附密钥；伪造 `acl:consumerKey=LEAK` 过滤条件被剥离 | 14/14 PASS | ✅ PASS |

### 2.5 未测项

| # | 测试项 | 状态 | 原因 |
|---|---|---|---|
| 12 | 带真实 key 实测（HTTP 200 数据路径） | **N/A** | 无 ODPT 密钥（环境变量空 + `/data/secrets/odpt.env` 不存在）。已用 mock 覆盖 200 路径；建议取得 key 后复测（见第五节） |
| 13 | 服务端 limit 截断观测 | **N/A** | 匿名 403 拦截无法观测；客户端 `--limit` 行为由 mock 断言覆盖 |

---

## 三、ODPT token 结论

- **是否必需：必需。** 所有 `/api/v4/` 数据端点（`odpt:Operator / Station / Railway / TrainTimetable / StationTimetable / TrainLocation / places`）一律要求 key，**不存在匿名可用的数据端点**。
- **证据（实测状态码与响应体）**：
  - 无 key → `HTTP 403` + `Require acl:consumerKey.`（n1 匿名探查 20 请求 + n2 复测 + QA 两条脚本真实请求，共 3 组独立实测一致）
  - 坏 key → `HTTP 403` + `Invalid acl:consumerKey.`（假值实测，2 条脚本均复现）
  - 403 响应体为 `text/html` 纯文本（非 JSON）；网关 Kong 0.11.2 + Express；仅支持 GET（OPTIONS → 404）
  - 传参方式：仅 query 参数 `?acl:consumerKey=`，无 header/Bearer 方式
- **注册地址**：https://developer.odpt.org → **Sign up**（免费，email 注册，需放行 `@odpt.org` 域邮件）→ 登录后右上 **"Access token"** 查看 PRIMARY / SECONDARY key；咨询 info@odpt.org
- **token 存放约定**（沙箱既定，README/SKILL.md/脚本三方一致）：
  - 文件：`/data/secrets/odpt.env`，内容形如 `ODPT_API_KEY=xxx`，权限 **600**，不入 git
  - 加载：`set -a; . /data/secrets/odpt.env; set +a`（之后 `process.env.ODPT_API_KEY` 生效）
  - 当前状态：该文件**尚不存在**（`/data/secrets/` 下仅 amap/bangumi/google-maps/wendao 四个无关密钥）；脚本密钥顺序 `process.env.ODPT_API_KEY` → `/data/secrets/odpt.env`，两者皆空时照常发真实请求由网关 403 兜底并打印指引
- 附：限流 60 次/分 · 3600 次/时 · 24000 次/日（`X-RateLimit-*` 响应头含剩余额度）；API 版本 v4，文档 4.16

---

## 四、ClawHub 发布结论

**结论：发布未成功执行。CLI 与技能内容均已就绪，唯一硬阻塞是环境中不存在任何 ClawHub 登录态，真实发布被前置校验拒绝。未伪造任何发布产物。**

| 检查项 | 命令 | 实测结果 | 判定 |
|---|---|---|---|
| CLI 全局安装 | `command -v clawhub` / `npm ls -g` | 不在 PATH | 未全局安装（可经 npx 使用） |
| npm 包存在 | `npm view clawhub` | clawhub@0.23.3（bin clawhub/clawdhub，maintainer steipete；注意 `@clawhub/cli` 是无关 BSV 项目） | ✅ |
| CLI 可运行 | `npx -y clawhub --help` | v0.23.3，Publishing 命令族齐全 | ✅ |
| 发布命令帮助 | `npx -y clawhub skill publish --help` | `Usage: clawhub skill publish [options] <path>`，参数 `--slug --name --owner --version --changelog --tags --categories --topics --dry-run --json` | ✅ |
| **登录态（硬阻塞）** | `clawhub whoami` / `clawhub token` | 均 `Error: Not logged in. Run: clawhub login`，exit 1；`~/.clawhub`、`~/.config/clawhub` 不存在；env 无 CLAWHUB_*；token 落盘点 `~/.config/clawhub/config.json` 实测无 authToken 字段 | ❌ |
| 技能内容 | 目录检查 | 含 SKILL.md（name=tokyo-transit, version=1.0.0, `metadata.openclaw` 命名空间）→ 满足官方硬性要求（缺 SKILL.md 会报 `Error: SKILL.md required`，上游已实测） | ✅ |
| **发布预演** | `npx -y clawhub skill publish /data/skills/tokyo-transit --dry-run` | `Would publish tokyo-transit@1.0.0`（exit 0，无需登录） | ✅ 计划就绪 |
| **真实发布** | `npx -y clawhub skill publish /data/skills/tokyo-transit --no-input` | `Error: Not logged in. Run: clawhub login`（**exit 1**），**零字节上传**，未产生 slug/版本/artifact/发布页 | ❌ 被拒 |
| 登录路径验证 | `clawhub login --no-browser`（限时中断） | 设备码流程可发起（user_code 15 分钟过期），但**必须人工在浏览器确认**；无头沙箱无法完成；无任何可注入的既有 token。过程产生的仅含 registry 字段的 config.json 已删除并复原目录 | ❌ 无法补齐 |
| 完整性核验 | 发布前后目录快照（文件清单+全量 sha256） | 完全一致，零写入；`clawhub list` 中仍为 "Manually installed (not tracked)"；目录中不存在 `.clawhub/`、`_meta.json`、`skill-card.md` | ✅ 零污染 |

**阻塞点（唯一）**：登录态缺失。**前置条件（按序补齐即可发布）**：
1. CLI：`npm i -g clawhub`（或继续 `npx -y clawhub`）
2. 账号与登录（需人工）：`clawhub login`（设备码）或 `clawhub login --token <token>`；账号需为"足够老的 GitHub 账号"以通过官方 upload gate（docs.openclaw.ai/clawhub 原文）
3. 技能元数据：已满足；发布时可显式 `--slug tokyo-transit --version 1.0.0 --changelog ... --tags latest`
4. 发布后产物（`.clawhub/origin.json`、`_meta.json`、`skill-card.md`）只能由 ClawHub 流程生成，**严禁手工伪造**（本次未生成、未伪造）

---

## 五、遗留问题与建议

| # | 遗留问题 | 建议 |
|---|---|---|
| 1 | **无 ODPT 密钥**：带真实 key 的 200 成功路径未做过真实端到端（仅 mock 覆盖） | 按 https://developer.odpt.org 免费注册（Sign up，放行 @odpt.org 邮件）→ 右上 "Access token" 取 PRIMARY key → 写入 `/data/secrets/odpt.env`（`ODPT_API_KEY=...`，chmod 600）→ `set -a; . /data/secrets/odpt.env; set +a` → 复测：`node scripts/odpt_query.js odpt:Operator --limit 3`（应 200）与 `node scripts/odpt_station.js 新宿`（应返回多语言站名+坐标+换乘线路） |
| 2 | **ClawHub 未登录**，真实发布被拒 | 需人工在有浏览器的环境完成 `clawhub login`（设备码 clawhub.ai/cli/device）或 `clawhub login --token`；账号需过 GitHub 年龄门槛。登录后重跑 `clawhub skill publish /data/skills/tokyo-transit --dry-run` 核对计划再正式发布（建议带 `--slug tokyo-transit --version 1.0.0 --changelog "首版：ODPT v4 车站/线路/运营者/时刻表/实时位置查询" --tags latest`） |
| 3 | SKILL.md frontmatter 未声明密钥依赖（`metadata.openclaw.requires.env`） | 参照 amap-lbs-skill 写法补 `requires.env: [ODPT_API_KEY]` 与 `primaryEnv`，使 ClawHub 安装方可感知密钥前置要求（非硬性，不阻塞发布） |
| 4 | SKILL.md §3"两者都缺失时…不要反复空跑"与脚本"单次真实请求探明 403"并存 | 语义不冲突（脚本不重试），可将措辞细化为"单次探测可、循环重试不可"，消除读者歧义 |
| 5 | 限流配额（60/分·3600/时·24000/日）下的大规模拉取策略未验证 | 时刻表类端点务必用 `odpt:railway`/`odpt:operator`/`odpt:station` 收窄（`limit` 是截断保护非分页）；批量场景观察 `X-RateLimit-Remaining-*` 控制节奏；可考虑对 fan-out 加 429 退避（现已有 429 分支处理） |
| 6 | README 目录结构一节未列入 `references/` 与 `test_odpt_station.js` | 小幅补全文档即可，不影响功能 |
| 7 | 上游 n1 沙箱曾报 I/O 异常（写文件后丢失）；本环境未复现 | 关键证据已在本报告与 notes 文件双份固化；后续跨沙箱任务建议落盘后立即 `wc -l` 复核 |

---

*报告完。生成于 2026-09-27 17:21 (+0800)，沙箱 bot-2d8f9b087270da0bcfe177a5e（docker，healthy）。*

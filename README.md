# tokyo-transit — Agent 操作指南

你是代理：用户查询日本（尤其东京）公共交通数据时，用本目录两个零依赖 Node.js（≥18）脚本直接调 ODPT 官方 API，输出原始数据。**本技能不做换乘规划。**

## ⚡ 核心原则

**1. 查车站直接传站名，不要先拉全量再过滤！**

```bash
# ✅ 正确 — 一条命令搞定（日/英站名均可，自动模糊匹配，扫全部 42 家运营方）
node scripts/odpt_station.js 新宿
node scripts/odpt_station.js Shinjuku --operator TokyoMetro

# ❌ 错误 — 不要这样！
node scripts/odpt_query.js odpt:Station   # ← 全量拉取会被服务端截断、漏结果，还烧配额
```

**2. 时刻表查询必须先收窄**：`odpt:TrainTimetable` / `odpt:StationTimetable` 必须带 `odpt:operator` 或 `odpt:railway` / `odpt:station` 过滤。

**3. 换乘规划类问题（怎么坐/最快/票价）直接告知无此能力**；可退而提供两站各自的线路/时刻原始数据，勿用通用知识臆造方案。

## 覆盖范围

- ✅ 铁路/公交：关东 42 家运营方 — JR东日本、东京Metro、都营、京王、小田急（含箱根）、东武、西武、京急、京成、横滨市营、多摩单轨、ゆりかもめ 等
- ✅ 航空：全日本航班数据（全日空、JAL、ZIPAIR、Air Do 等）
- ❌ 不含关西/名古屋/九州（大阪搜「梅田」无结果，别试）
- ❌ 无换乘规划能力

## ✅ 当前部署状态

- 密钥已配置在 `/data/secrets/odpt.env`（权限 600，不入 git）。**执行任何脚本前先加载：**

```bash
set -a; . /data/secrets/odpt.env; set +a
```

- 脚本亦支持 `ODPT_API_KEY` 环境变量；任何情况下不回显、不落盘打印密钥值
- 两者均缺失时：不要伪造密钥、不要反复空跑，指引用户到 https://developer.odpt.org 免费注册（咨询 info@odpt.org）
- 限流（共享额度）：60 次/分 · 3600 次/时 · 24000 次/日

## 命令参考

### 按站名查站（首选入口）

```bash
node scripts/odpt_station.js 秋葉原
node scripts/odpt_station.js Shinjuku --operator JR-East
node scripts/odpt_station.js 五反田 --railway Tokyu.Ikegami --limit 3   # ✅ 此处 --limit 安全（客户端截断）
```

### 通用查询（资源类型 + 谓词过滤收窄；**禁用 --limit**）

```bash
node scripts/odpt_query.js odpt:Operator
node scripts/odpt_query.js odpt:Railway 'odpt:operator=odpt.Operator:TokyoMetro'
node scripts/odpt_query.js odpt:StationTimetable 'odpt:station=odpt.Station:TokyoMetro.Tozai.Nakano'
node scripts/odpt_query.js odpt:Station 'dc:title=東京,五反田'        # 逗号 = OR
node scripts/odpt_query.js odpt:TrainLocation 'odpt:railway=odpt.Railway:TokyoMetro.Tozai'
```

常用资源：`odpt:Operator` 运营者 · `odpt:Station` 车站 · `odpt:Railway` 线路 · `odpt:TrainTimetable`/`odpt:StationTimetable` 时刻表 · `odpt:TrainLocation` 列车实时位置 · `places` 地理检索

### 输出选项（两脚本不同，勿混用）

| 选项 | odpt_query.js | odpt_station.js |
|------|------|------|
| `--full` | ✅ 完整解析字段 | ✅ 原始 JSON（station 脚本要 JSON 输出就用它） |
| `--json` | ✅ 紧凑单行 JSON（供 jq/管道） | ❌ 无此选项，退出码 2 报「未知选项」 |
| `--limit N` | ⛔ **禁用**：透传官方 `limit` 参数，实测必返回 `[]`（HTTP 200 假成功） | ✅ 展示条数（默认 10），客户端截断、非分页 |
| `--operator` / `--railway` | 用过滤参数 `odpt:operator=...` 表达 | ✅ 专用选项，可简写 `TokyoMetro` |

## 注意事项

- **ODPT API 的 `limit` query 参数是坑**：带上即返回空数组（HTTP 200 假成功）。直接 curl 别带；`odpt_query.js` 的 `--limit` 恰好会透传该参数，故**通用查询一律禁用 `--limit`、只用谓词过滤收窄**（`odpt_station.js` 的 `--limit` 为客户端截断，安全）
- 时刻表类（`odpt:TrainTimetable` / `odpt:StationTimetable`）数据量巨大，必须加 `odpt:operator` 或 `odpt:railway` / `odpt:station` 过滤后再查
- 字段名带 `odpt:` 前缀（`dc:` / `geo:` 同理）；多语言对象可下钻过滤（`odpt:stationTitle.ja` / `odpt:stationTitle.en`）；逗号 = OR（如 `dc:title=東京,五反田`）
- 403（`Require acl:consumerKey.` / `Invalid acl:consumerKey.`）= 密钥缺失或错误，先排查密钥加载，勿盲目重试烧配额
- 批量查询注意限流节奏，响应头 `X-RateLimit-Remaining-*` 可看剩余额度

## License

MIT

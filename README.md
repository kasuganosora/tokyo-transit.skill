# tokyo-transit

基于 [ODPT（公共交通开放数据中心）](https://odpt.org)官方 API 的 AI Agent Skill — 让 Agent 直接查询日本车站、线路、时刻表、列车实时位置与航班数据。零依赖 Node.js（≥18）。

## 🤖 AI 安装说明（给 Agent 看的）

**一句话：** 下载仓库 → 解压/克隆到项目 `skill/` 目录 → 配置 API key → Agent 自动启用。

**目录结构：**
```
你的项目/
└── skill/
    └── tokyo-transit/
        ├── SKILL.md            ← Agent 读到这个自动加载技能
        └── scripts/
            ├── odpt_query.js    ← 通用查询（任意资源类型 + 过滤）
            └── odpt_station.js  ← 按站名搜站（首选入口）
```

**完整命令：**

```bash
# 1. 克隆到 skill/ 目录
git clone https://github.com/kasuganosora/tokyo-transit.skill.git skill/tokyo-transit

# 2. 配置密钥（免费注册即得：https://developer.odpt.org）
echo 'ODPT_API_KEY=你的key' > skill/tokyo-transit/.env
chmod 600 skill/tokyo-transit/.env

# 3. 完成 — Agent 会自动根据用户意图调用脚本
node skill/tokyo-transit/scripts/odpt_station.js 新宿
```

> **原理：** Agent 扫描工作目录下的 `skill/*/SKILL.md`，读取技能定义后，根据用户意图自动选择命令执行。用户无需手动教 Agent 怎么用。密钥通过环境变量 `ODPT_API_KEY` 传入（`.env` / `odpt.env` 均可 `source` 后使用），任何情况下不回显、不落盘到 git。

---

## 覆盖范围（先读这个，避免踩坑）

- ✅ **铁路/公交**：关东 42 家运营方 — JR东日本、东京Metro、都营、京王、小田急（含箱根）、东武、西武、京急、京成、横滨市营、多摩单轨、ゆりかもめ 等
- ✅ **航空**：全日本航班数据（全日空、JAL、ZIPAIR、Air Do 等）
- ❌ **不含关西/名古屋/九州**（大阪搜「梅田」无结果，别试）
- ❌ **无换乘规划能力**（"A站到B站怎么坐/最快/票价"答不了；可退而提供两站各自的线路/时刻原始数据，勿臆造方案）

## 快速开始

```bash
# 按站名查站（日文/英文均可，自动模糊匹配，扫全部42家运营方）
node scripts/odpt_station.js 秋葉原
node scripts/odpt_station.js Shinjuku --operator TokyoMetro   # 收窄范围

# 通用查询：资源类型 + 过滤条件
node scripts/odpt_query.js odpt:Operator --limit 50
node scripts/odpt_query.js odpt:Railway odpt:operator=odpt.Operator:TokyoMetro --limit 5
node scripts/odpt_query.js odpt:StationTimetable odpt:station=odpt.Station:TokyoMetro.Tozai.Nakano --limit 3
node scripts/odpt_query.js odpt:Station dc:title=東京,五反田 --limit 10   # 逗号 = OR
```

## 命令参考

| 需求 | 命令 |
|------|------|
| 按站名搜站（**首选**） | `odpt_station.js 新宿` |
| 任意资源通用查询 | `odpt_query.js <资源类型> [过滤条件...] --limit N` |
| 完整原始 JSON | 加 `--full` |
| 紧凑单行 JSON（供 jq/管道） | `odpt_query.js` 加 `--json`（station 脚本无此选项） |

常用资源类型：`odpt:Operator` 运营者 · `odpt:Station` 车站 · `odpt:Railway` 线路 · `odpt:TrainTimetable` 列车时刻表 · `odpt:StationTimetable` 车站时刻表 · `odpt:TrainLocation` 列车实时位置 · `places` 地理检索

## 注意事项

- **API key 必需**：所有端点匿名一律 403。注册地址 https://developer.odpt.org ，配额 60 次/分 · 3600 次/时 · 24000 次/日（响应头 `X-RateLimit-Remaining-*` 看剩余额度）
- **`limit` query 参数是坑**：直接 curl 时别带，带上会返回空数组；限条数只用脚本的 `--limit`（且是截断保护，非分页，API 无 offset）
- `odpt:TrainTimetable` / `odpt:StationTimetable` 数据量巨大，必须加 `odpt:operator` / `odpt:railway` / `odpt:station` 过滤后再查
- 字段名带 `odpt:` 前缀；多语言对象可下钻（`odpt:stationTitle.ja` / `.en`）；逗号 = OR
- 403（`Require acl:consumerKey.` / `Invalid acl:consumerKey.`）= 密钥缺失或错误，先排查密钥加载，勿盲目重试烧配额

## License

MIT

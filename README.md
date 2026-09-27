# tokyo-transit

日本（尤其东京）公共交通**原始数据**查询技能，基于官方数据源 ODPT（公共交通开放数据中心，https://odpt.org）。

> 本技能只提供原始数据查询，**不支持换乘规划**。

## 简介

通过 ODPT 官方 API（`https://api.odpt.org/api/v4/`）查询：

- 车站（多语言站名、坐标、车站编号、可换乘线路）
- 线路（odpt:Railway）
- 运营者（东京Metro、JR东日本、都营交通等）
- 列车时刻表 / 车站时刻表
- 列车实时位置
- 按坐标半径的地理检索（places）

所有数据端点均需 access token（query 参数 `acl:consumerKey`），匿名访问返回 403。

## 快速开始

```bash
# 1. 配置密钥（首次）：写入 /data/secrets/odpt.env（权限 600，不入 git）
#    内容形如：ODPT_API_KEY=你的key

# 2. 每次执行前加载
set -a; . /data/secrets/odpt.env; set +a

# 3. 查询
node scripts/odpt_query.js odpt:Station odpt:operator=odpt.Operator:TokyoMetro --limit 5
node scripts/odpt_station.js 新宿
```

详细用法见 [SKILL.md](SKILL.md)。

## 获取 Access Token（免费注册）

1. 打开 https://developer.odpt.org/
2. 点击 **Sign up** 注册（email 注册；需放行 `@odpt.org` 域邮件）
3. 登录后点击页面右上 **"Access token"**，查看 PRIMARY / SECONDARY key
4. 咨询：info@odpt.org

## 目录结构

```
tokyo-transit/
├── SKILL.md              # 技能定义与完整用法（代理主入口）
├── README.md             # 本文件
└── scripts/
    ├── odpt_query.js     # 通用查询：资源类型 + 过滤参数 + --limit/--full/--json
    └── odpt_station.js   # 按站名快捷查车站
```

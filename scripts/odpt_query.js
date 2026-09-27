#!/usr/bin/env node
/**
 * odpt_query.js — 东京公共交通开放数据 (ODPT) API v4 命令行查询工具
 *
 * 特点：
 *   - 零依赖：仅用 Node.js ≥18 内置模块与原生 fetch
 *   - 鉴权：仅支持 query 参数 acl:consumerKey（ODPT 网关不认 header 方式）
 *   - URL 编码：资源类型与过滤参数中的 ":" 等特殊字符一律百分号编码
 *   - 密钥安全：从不打印密钥内容；请求日志里的 URL 不含密钥
 *
 * 用法：
 *   node scripts/odpt_query.js <资源类型> [键=值 过滤条件...] [选项]
 *
 * 示例：
 *   node scripts/odpt_query.js odpt:Station 'odpt:railway=odpt.Railway:TokyoMetro.Tozai'
 *   node scripts/odpt_query.js Railway 'odpt:operator=odpt.Operator:TokyoMetro' --limit 10
 *   node scripts/odpt_query.js odpt:TrainTimetable 'odpt:railway=odpt.Railway:TokyoMetro.Tozai' --json
 *   node scripts/odpt_query.js Station 'dc:title=東京,大手町' --full
 *
 * 密钥加载顺序：
 *   1) process.env.ODPT_API_KEY
 *   2) /data/secrets/odpt.env 中的 ODPT_API_KEY=xxx 行（约定权限 600）
 *   3) 都为空则照常发请求，由 API 返回 403 并给出明确指引
 *
 * 退出码：0 成功；1 API/网络错误；2 用法错误。
 */

'use strict';

const API_BASE = 'https://api.odpt.org/api/v4/';
const SECRETS_FILE = '/data/secrets/odpt.env';
const REGISTER_URL = 'https://developer.odpt.org';
const DISPLAY_CAP = 20; // 默认最多展示条数
const REQUEST_TIMEOUT_MS = 30000;

/* ------------------------------------------------------------------ *
 * 帮助 / 用法
 * ------------------------------------------------------------------ */

function usage(stream) {
  const w = (s) => stream.write(s + '\n');
  w('ODPT (东京公共交通开放数据) API v4 查询工具 — 零依赖');
  w('');
  w('用法:');
  w('  node scripts/odpt_query.js <资源类型> [过滤条件...] [选项]');
  w('');
  w('资源类型 (常用):');
  w('  odpt:Operator        事業者 (東京メトロ/JR东日本/都营等)');
  w('  odpt:Railway         路线');
  w('  odpt:Station         车站');
  w('  odpt:TrainTimetable  列车时刻表');
  w('  odpt:StationTimetable 车站时刻表');
  w('  odpt:TrainLocation   列车实时位置');
  w('  places               地点检索');
  w('  (可省略 odpt: 前缀，如 `Station` 等价 `odpt:Station`)');
  w('');
  w('过滤条件:');
  w('  形如 `键=值`，原样透传为 query 参数；冒号等特殊字符自动 URL 编码');
  w('  例: odpt:operator=odpt.Operator:TokyoMetro');
  w('      odpt:railway=odpt.Railway:TokyoMetro.Tozai');
  w('      dc:title=東京,五反田            (逗号 = OR)');
  w('      odpt:stationTitle.en=Otemachi');
  w('');
  w('选项:');
  w('  --limit N   透传 limit=N (系统输出上限截断保护，非分页；请用谓词收窄)');
  w('  --full      输出原始完整 JSON (默认仅保留关键字段)');
  w('  --json      紧凑单行 JSON (供管道处理；GET/统计等信息走 stderr)');
  w('  -h, --help  显示本帮助');
  w('');
  w('示例:');
  w("  node scripts/odpt_query.js odpt:Station 'odpt:railway=odpt.Railway:TokyoMetro.Tozai'");
  w("  node scripts/odpt_query.js Railway 'odpt:operator=odpt.Operator:TokyoMetro' --limit 10");
  w("  node scripts/odpt_query.js odpt:TrainLocation 'odpt:railway=odpt.Railway:TokyoMetro.Tozai'");
  w("  node scripts/odpt_query.js Station 'dc:title=東京,大手町' --json");
  w('');
  w(`密钥: 取 process.env.ODPT_API_KEY，否则解析 ${SECRETS_FILE}；`);
  w(`      均为空时请求会得到 403。注册(免费): ${REGISTER_URL}`);
}

/* ------------------------------------------------------------------ *
 * 参数解析
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
  const out = { resource: '', filters: [], limit: null, full: false, json: false, help: false, error: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { out.help = true; return out; }
    if (a === '--full') { out.full = true; continue; }
    if (a === '--json') { out.json = true; continue; }
    if (a === '--limit' || a.startsWith('--limit=')) {
      const v = a === '--limit' ? argv[++i] : a.slice('--limit='.length);
      if (v === undefined || !/^\d+$/.test(v) || Number(v) < 1) {
        out.error = `--limit 需要正整数 (收到: ${v === undefined ? '(缺值)' : JSON.stringify(v)})`;
        return out;
      }
      out.limit = Number(v);
      continue;
    }
    if (a.startsWith('-') && a !== '-') {
      out.error = `未知选项: ${a}`;
      return out;
    }
    if (!out.resource) { out.resource = a; continue; }
    const eq = a.indexOf('=');
    if (eq <= 0) {
      out.error = `过滤条件必须形如 键=值 (收到: ${JSON.stringify(a)})`;
      return out;
    }
    out.filters.push([a.slice(0, eq), a.slice(eq + 1)]);
  }
  if (!out.error && !out.resource) out.error = '缺少资源类型';
  return out;
}

/** 归一化资源类型: Station -> odpt:Station; places 保持原样 */
function normalizeResource(raw) {
  const r = String(raw).trim();
  if (r.includes(':')) return r;
  if (r === 'places') return r;
  return 'odpt:' + r;
}

/** 手工百分号编码 (空格用 %20，比 URLSearchParams 的 + 更贴近原样) */
function enc(s) {
  return encodeURIComponent(String(s));
}

/** 构造请求 URL；excludeKey=true 时不含 acl:consumerKey（用于日志） */
function buildUrl(resource, filters, limit, excludeKey, key) {
  const params = [];
  for (const [k, v] of filters || []) {
    if (k === 'acl:consumerKey') continue; // 密钥只走统一入口，避免命令行泄漏
    params.push(`${enc(k)}=${enc(v)}`);
  }
  if (limit != null) params.push(`limit=${limit}`);
  const path = enc(normalizeResource(resource));
  let url = `${API_BASE}${path}`;
  if (params.length) url += '?' + params.join('&');
  if (!excludeKey && key) url += (params.length ? '&' : '?') + `${enc('acl:consumerKey')}=${enc(key)}`;
  return url;
}

/* ------------------------------------------------------------------ *
 * 密钥加载 (从不打印密钥内容)
 * ------------------------------------------------------------------ */

function loadApiKey(envObj, readFileSync, filePath) {
  const fromEnv = String((envObj && envObj.ODPT_API_KEY) || '').trim();
  if (fromEnv) return { key: fromEnv, source: '环境变量 ODPT_API_KEY' };
  try {
    const text = readFileSync(filePath || SECRETS_FILE, 'utf8');
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const m = line.match(/^(?:export\s+)?ODPT_API_KEY\s*=\s*(.*)$/);
      if (!m) continue;
      let v = m[1].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      v = v.trim();
      if (v) return { key: v, source: `密钥文件 ${filePath || SECRETS_FILE}` };
    }
  } catch (err) {
    if (err && err.code === 'ENOENT') { /* 文件不存在属正常路径，静默 */ }
    else process.stderr.write(`# 警告: 读取密钥文件失败 (${err && err.code ? err.code : err && err.message}): 继续走环境变量/报错流程\n`);
  }
  return { key: '', source: null };
}

/** 把输出中意外出现的密钥打码 */
function scrub(text, key) {
  return key && String(text).split(key).length > 1 ? String(text).split(key).join('***') : String(text);
}

/* ------------------------------------------------------------------ *
 * 结果精简: 按资源类型挑选关键字段
 * 字段表依据 references/odpt-api-notes.md 字段速查表 (ODPT API 仕様 4.16)
 * ------------------------------------------------------------------ */

const FIELDS = {
  'odpt:Operator': ['@id', 'dc:title', 'odpt:operatorTitle'],
  'odpt:Railway': ['@id', 'dc:title', 'odpt:railwayTitle', 'odpt:operator', 'odpt:lineCode', 'odpt:color', 'odpt:stationOrder@count'],
  'odpt:Station': ['@id', 'dc:title', 'odpt:stationTitle', 'odpt:operator', 'odpt:railway', 'odpt:stationCode', 'geo:lat', 'geo:long', 'odpt:connectingRailway'],
  'odpt:TrainTimetable': ['@id', 'odpt:trainNumber', 'odpt:operator', 'odpt:railway', 'odpt:originStation', 'odpt:destinationStation', 'odpt:trainTimetableObject@count'],
  'odpt:StationTimetable': ['@id', 'odpt:station', 'odpt:railway', 'odpt:operator', 'odpt:railDirection', 'odpt:stationTimetableObject@count'],
  'odpt:TrainLocation': ['@id', 'odpt:trainNumber', 'odpt:operator', 'odpt:railway', 'odpt:delay', 'geo:lat', 'geo:long', 'odpt:fromStation', 'odpt:toStation'],
  'places': ['@id', 'dc:title', 'geo:lat', 'geo:long', 'odpt:operator'],
};
const GENERIC_FIELDS = ['@id', '@type', 'dc:title', 'odpt:operator', 'odpt:railway', 'odpt:station', 'odpt:stationCode', 'odpt:trainNumber', 'geo:lat', 'geo:long', 'odpt:delay'];

/** 压缩多语言标题对象 {ja,en,...} -> "大手町 (Ōtemachi)" */
function compactTitle(obj) {
  const langs = Object.keys(obj).filter((k) => typeof obj[k] === 'string' || typeof obj[k] === 'number');
  if (!langs.length) return JSON.stringify(obj);
  const pick = (l) => (obj[l] !== undefined ? String(obj[l]) : '');
  const ja = pick('ja') || pick('ja-Hrkt') || pick('');
  const en = pick('en');
  if (ja && en && ja !== en) return `${ja} (${en})`;
  return ja || en || String(obj[langs[0]]);
}

function compactValue(v) {
  if (v === null) return null;
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x === 'string' || typeof x === 'number')) return v.join(',');
    return `[${v.length} 项]`; // 对象数组(如时刻表明细)只给计数，详情用 --full
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length && keys.every((k) => typeof k === 'string' && k.length <= 7 && /^[a-zA-Z]/.test(k)) && keys.every((k) => typeof v[k] !== 'object')) {
      return compactTitle(v); // 多语言标题形对象
    }
    return JSON.stringify(v);
  }
  if (typeof v === 'string' && v.length > 100) return v.slice(0, 100) + '…';
  return v;
}

function pickFields(item, fieldList) {
  const out = {};
  for (const f of fieldList) {
    if (f.endsWith('@count')) {
      const k = f.slice(0, -'@count'.length);
      if (Array.isArray(item[k])) out[k + '#'] = item[k].length;
      continue;
    }
    if (item[f] !== undefined) out[f] = compactValue(item[f]);
  }
  // 兜底: 精简后几乎为空(未知资源/新字段)时，抓取前几个标量字段保证可用
  if (Object.keys(out).length <= 1) {
    for (const [k, v] of Object.entries(item)) {
      if (typeof v === 'object' && v !== null) continue;
      if (out[k] === undefined) out[k] = v;
      if (Object.keys(out).length >= 8) break;
    }
  }
  return out;
}

function summarizeItems(items, resource) {
  const list = FIELDS[normalizeResource(resource)] || GENERIC_FIELDS;
  return items.map((it) => pickFields(it, list));
}

/* ------------------------------------------------------------------ *
 * 输出
 * ------------------------------------------------------------------ */

function emitResults({ data, resource, shown, json, full, err }) {
  if (json) {
    // stdout 仅一行紧凑 JSON，便于 jq/管道
    const payload = full ? shown : summarizeItems(shown, resource);
    process.stdout.write(JSON.stringify(payload) + '\n');
    err.write(`# 共 ${data.length} 条匹配，输出前 ${shown.length} 条${data.length > shown.length ? ` (默认上限 ${DISPLAY_CAP})` : ''}\n`);
    return;
  }
  if (full) {
    process.stdout.write(JSON.stringify(shown, null, 2) + '\n');
  } else {
    summarizeItems(shown, resource).forEach((row, i) => {
      process.stdout.write(`${String(i + 1).padStart(3)}) ${JSON.stringify(row)}\n`);
    });
  }
  if (data.length > shown.length) {
    err.write(`… 共 ${data.length} 条匹配，默认仅展示前 ${shown.length} 条。\n`);
    err.write(`  提示: limit 是系统输出上限的截断保护而非分页(无 offset/page)；请用谓词过滤收窄，如\n`);
    err.write(`  'odpt:railway=odpt.Railway:TokyoMetro.Tozai' 或 'dc:title=東京,大手町'(逗号=OR)，或 --limit N 控制。\n`);
  }
}

/* ------------------------------------------------------------------ *
 * 错误处理
 * ------------------------------------------------------------------ */

function failHTTP(status, bodyText, { keyLoaded, err, key }) {
  const body = scrub(String(bodyText || '').replace(/\s+/g, ' ').trim().slice(0, 300), key);
  err.write(`\n[错误] HTTP ${status}\n`);
  err.write(`  响应体摘要: ${body || '(空)'}\n`);
  if (status === 403) {
    if (!keyLoaded) {
      err.write(`  403 = 缺少访问令牌 (ODPT 无匿名访问，所有数据端点均需 acl:consumerKey)。\n`);
      err.write(`  请按以下步骤配置:\n`);
      err.write(`    1) 注册(免费): ${REGISTER_URL} -> Sign up\n`);
      err.write(`    2) 登录后右上角 "Access token" 复制 PRIMARY key\n`);
      err.write(`    3) 保存到 ${SECRETS_FILE} (内容: ODPT_API_KEY=你的key，权限 600)，然后:\n`);
      err.write(`       set -a; . ${SECRETS_FILE}; set +a\n`);
      err.write(`    4) 或临时使用: ODPT_API_KEY=你的key node scripts/odpt_query.js ...\n`);
    } else {
      err.write(`  403 = 令牌无效。请核对 key 是否完整(勿带引号/空格/换行)，\n`);
      err.write(`  可在 ${REGISTER_URL} 右上 "Access token" 处确认 PRIMARY/SECONDARY key；咨询 info@odpt.org。\n`);
    }
  } else if (status === 404) {
    err.write(`  404 = 资源类型不存在。常见类型: odpt:Station / odpt:Railway / odpt:TrainTimetable / odpt:StationTimetable / odpt:Operator / odpt:TrainLocation / places\n`);
  } else if (status === 429) {
    err.write(`  429 = 触发限流 (60 次/分 · 3600 次/时 · 24000 次/日)。请稍后重试并加谓词过滤减少单次数据量。\n`);
  } else if (status >= 500) {
    err.write(`  ${status} = ODPT 网关/服务端异常，稍后重试;持续失败可联系 info@odpt.org。\n`);
  } else {
    err.write(`  请检查资源类型与过滤参数拼写 (字段须带 odpt: / dc: / geo: 前缀)。\n`);
  }
  process.exit(1);
}

function failNetwork(error, err) {
  const code = (error && (error.cause && error.cause.code)) || error.code || '';
  err.write(`\n[错误] 请求失败: ${error && error.name ? error.name : ''} ${scrub(error && error.message, '')}\n`);
  if (/TIMEOUT|ABORT/i.test(String(error && error.name))) {
    err.write(`  请求超时 (${REQUEST_TIMEOUT_MS / 1000}s)。可重试;ODPT 大资源(如全量 StationTimetable)响应较慢，建议加过滤条件。\n`);
  } else if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    err.write(`  DNS 解析失败(${code || 'ENOTFOUND'})，请检查网络/DNS 后重试。\n`);
  } else if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT') {
    err.write(`  网络连接异常(${code})，请检查出网代理/防火墙后重试。\n`);
  } else {
    err.write(`  若持续失败请检查 Node 版本 ≥18 (需要原生 fetch) 与网络连通性。\n`);
  }
  process.exit(1);
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */

async function main(argv) {
  const args = parseArgs(argv);
  const err = process.stderr;
  if (args.help) { usage(process.stdout); return 0; }
  if (args.error) { err.write(`[用法错误] ${args.error}\n\n`); usage(err); return 2; }

  const { key, source } = loadApiKey(process.env, require('fs').readFileSync, SECRETS_FILE);
  if (source) err.write(`# 密钥来源: ${source}\n`);

  const logUrl = buildUrl(args.resource, args.filters, args.limit, true, null);
  const reqUrl = buildUrl(args.resource, args.filters, args.limit, false, key);
  // 请求前打印一行 GET <不含key的URL> (走 stderr，保证 --json 的 stdout 纯净)
  err.write(`GET ${logUrl}\n`);
  if (!key) err.write(`# 注意: 未找到 ODPT_API_KEY(环境变量与 ${SECRETS_FILE} 均为空)，本次请求预期 403\n`);

  let res;
  try {
    res = await fetch(reqUrl, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    return failNetwork(error, err), 1;
  }

  const text = await res.text();
  if (res.status !== 200) return failHTTP(res.status, text, { keyLoaded: Boolean(key), err, key }), 1;

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    err.write(`\n[错误] HTTP 200 但响应不是合法 JSON\n  响应体摘要: ${scrub(text, key).replace(/\s+/g, ' ').slice(0, 300)}\n`);
    return 1;
  }

  if (!Array.isArray(data)) {
    // 非数组(单对象/错误对象)直接输出
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    err.write(`# 返回单对象(${typeof data})，直接输出\n`);
    return 0;
  }

  const shown = data.slice(0, DISPLAY_CAP);
  err.write(`# HTTP 200 · ${normalizeResource(args.resource)} · 匹配 ${data.length} 条\n`);
  emitResults({ data, resource: args.resource, shown, json: args.json, full: args.full, err });
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => { process.stderr.write(`[内部错误] ${e && e.stack ? e.stack : e}\n`); process.exit(1); }
  );
} else {
  // 供测试引入，不产生副作用
  module.exports = { parseArgs, normalizeResource, buildUrl, loadApiKey, summarizeItems, pickFields, compactValue, usage, FIELDS, GENERIC_FIELDS };
}

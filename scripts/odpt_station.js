#!/usr/bin/env node
// odpt_station.js — 东京公共交通开放数据中心（ODPT）车站多语言检索 CLI
//
// 用法：node scripts/odpt_station.js <站名关键词> [选项]
// 数据源：https://api.odpt.org/api/v4/odpt:Station（API v4，文档版本 4.16）
//
// 特性：
//   · 零第三方依赖，仅用 Node.js >= 18 的原生 fetch
//   · 对每站 odpt:stationTitle 多语言对象（ja/en/zh-Hans/zh-Hant/ko 等）
//     做不区分大小写的包含匹配（含"駅/站"结尾自动降级重试）
//   · 未指定 --operator/--railway 时，先取运营公司列表再逐家检索，
//     规避服务端输出上限截断（官方 limit 是截断保护，非分页游标）
//   · 密钥顺序：process.env.ODPT_API_KEY → /data/secrets/odpt.env（权限 600 约定），
//     绝不打印/回显密钥；本文件不含任何真实密钥；两者皆空时照常发出真实请求，
//     由网关返回 403 "Require acl:consumerKey." 并打印注册/配置指引（退出码 1）
//
// 退出码：0=有匹配；1=无匹配或请求失败（含缺 key 的网关 403）；2=参数错误

'use strict';

const fs = require('node:fs');

const API_BASE = 'https://api.odpt.org/api/v4';
const STATION_PATH = 'odpt:Station';
const OPERATOR_PATH = 'odpt:Operator';
const KEY_FILE = '/data/secrets/odpt.env';
const SIGNUP_URL = 'https://developer.odpt.org';
const REQUEST_TIMEOUT_MS = (() => {
  const v = Number.parseInt(process.env.ODPT_TIMEOUT_MS || '', 10);
  return Number.isFinite(v) && v >= 1000 && v <= 120000 ? v : 20000; // 慢网可用 ODPT_TIMEOUT_MS 覆盖
})();
const FANOUT_CONCURRENCY = 4;
const PREFERRED_LANGS = ['ja', 'en', 'zh-Hans', 'zh-Hant', 'ko'];

/* ------------------------------------------------------------------ *
 * 参数解析
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
  const opts = { keyword: null, operator: null, railway: null, limit: 10, full: false, help: false, errors: [] };

  const needValue = (args, i, name) => {
    const v = args[i + 1];
    if (v === undefined || v === '') {
      opts.errors.push(`选项 ${name} 缺少取值`);
      return null;
    }
    return v;
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '--full') opts.full = true;
    else if (a === '--operator') opts.operator = needValue(argv, i++, '--operator');
    else if (a.startsWith('--operator=')) opts.operator = a.slice('--operator='.length);
    else if (a === '--railway') opts.railway = needValue(argv, i++, '--railway');
    else if (a.startsWith('--railway=')) opts.railway = a.slice('--railway='.length);
    else if (a === '--limit') {
      const raw = needValue(argv, i++, '--limit');
      if (raw !== null) {
        const n = Number.parseInt(raw, 10);
        if (!Number.isFinite(n) || n <= 0 || String(n) !== String(raw).trim()) {
          opts.errors.push(`--limit 需为正整数，收到："${raw}"`);
        } else opts.limit = n;
      }
    } else if (a.startsWith('--limit=')) {
      const raw = a.slice('--limit='.length);
      const n = Number.parseInt(raw, 10);
      if (!Number.isFinite(n) || n <= 0 || String(n) !== raw.trim()) {
        opts.errors.push(`--limit 需为正整数，收到："${raw}"`);
      } else opts.limit = n;
    } else if (a.startsWith('-') && a !== '-') {
      opts.errors.push(`未知选项："${a}"（参见 -h/--help）`);
    } else if (opts.keyword === null) {
      opts.keyword = a;
    } else {
      opts.errors.push(`多余的参数："${a}"（站名关键词只需一个）`);
    }
  }

  if (!opts.help) {
    if (!opts.keyword && !opts.errors.length) opts.errors.push('缺少 <站名关键词>');
    if (opts.keyword !== null && !opts.keyword.trim()) opts.errors.push('<站名关键词> 不能为空白');
    opts.operator = normalizeId(opts.operator, 'odpt.Operator:');
    opts.railway = normalizeId(opts.railway, 'odpt.Railway:');
  }
  return opts;
}

// 容错：允许 odpt.Operator:TokyoMetro / TokyoMetro / 完整 http(s) URI 三种写法
function normalizeId(v, prefix) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s; // 完整 URI，原样透传
  if (s.startsWith(prefix)) return s;
  return prefix + s;
}

/* ------------------------------------------------------------------ *
 * 密钥加载（env → /data/secrets/odpt.env；绝不回显）
 * ------------------------------------------------------------------ */

function loadApiKey(env = process.env, file = env.ODPT_SECRETS_FILE || KEY_FILE) {
  const fromEnv = (env.ODPT_API_KEY || '').trim();
  if (fromEnv) return { key: fromEnv, source: '环境变量 ODPT_API_KEY', mode: null };

  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return { key: null, source: null, mode: null };
  }
  if (!st.isFile()) return { key: null, source: null, mode: null };

  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { key: null, source: `${file}（不可读）`, mode: st.mode };
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^export\s+/, '');
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^ODPT_API_KEY\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[1].trim();
    const q = v.length > 1 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")));
    if (q) v = v.slice(1, -1);
    v = v.trim();
    if (v) return { key: v, source: file, mode: st.mode };
  }
  return { key: null, source: `${file}（未找到 ODPT_API_KEY= 行）`, mode: st.mode };
}

function printMissingKeyHelp(checked) {
  console.error('⚠ 未找到 ODPT API 密钥' + (checked ? `（已检查：${checked}）` : ''));
  console.error('');
  console.error('获取密钥（免费）：');
  console.error(`  1. 打开 ${SIGNUP_URL} 并点击 Sign up（注意域名是 developer.odpt.org）`);
  console.error('     注册需能接收 @odpt.org 域名的邮件（请检查垃圾邮件过滤器）');
  console.error('  2. 登录后点击右上角 "Access token"，复制 PRIMARY 或 SECONDARY key');
  console.error('');
  console.error('配置方式（二选一，密钥不会被打印或回显）：');
  console.error('  export ODPT_API_KEY="你的key"');
  console.error('  printf \'ODPT_API_KEY=你的key\\n\' > /data/secrets/odpt.env && chmod 600 /data/secrets/odpt.env');
}

/* ------------------------------------------------------------------ *
 * HTTP 层
 * ------------------------------------------------------------------ */

class ApiError extends Error {
  constructor(status, lines, context) {
    super(`HTTP ${status}${context ? `（${context}）` : ''}`);
    this.name = 'ApiError';
    this.status = status;
    this.lines = lines;
  }
}

async function apiGet(pathname, params, key, timeoutMs = REQUEST_TIMEOUT_MS) {
  const url = new URL(`${API_BASE}/${pathname}`);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  // 官方仅支持 query 参数鉴权。无 key 时同样发真实请求（不带该参数），
  // 让网关自然返回 403 "Require acl:consumerKey."——与 odpt_query.js 口径一致
  if (key) url.searchParams.set('acl:consumerKey', key);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  let text;
  try {
    res = await fetch(url, { method: 'GET', signal: controller.signal, headers: { Accept: 'application/json' } });
    text = await res.text();
  } catch (err) {
    throw new Error(describeNetworkError(err));
  } finally {
    clearTimeout(timer);
  }
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null; // 网关 403 等返回 text/html，保持可诊断
  }
  return { ok: res.ok, status: res.status, statusText: res.statusText, body, text, headers: res.headers };
}

function describeNetworkError(err) {
  if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) {
    return `请求超时（${REQUEST_TIMEOUT_MS / 1000}s）：服务无响应，请稍后重试或检查网络。`;
  }
  const code = (err && err.cause && err.cause.code) || (err && err.code) || '';
  const map = {
    ENOTFOUND: 'DNS 解析失败：无法解析 api.odpt.org，请检查网络连通性。',
    EAI_AGAIN: 'DNS 解析暂时失败：请稍后重试或检查网络/DNS 配置。',
    ECONNREFUSED: '连接被拒绝：网络或出口受限，请检查网络/代理设置。',
    ECONNRESET: '连接被重置：网络不稳定或被中间设备打断，请重试。',
    ETIMEDOUT: '网络超时：请重试或检查网络。',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'TLS 证书校验失败：请检查系统时间与根证书。',
    SELF_SIGNED_CERT_IN_CHAIN: 'TLS 证书链异常（疑似代理劫持）：请检查网络环境。',
  };
  const hint = map[code] || (err && err.message) || '未知网络错误';
  return `网络请求失败：${hint}${code ? `（${code}）` : ''}`;
}

function describeHttpError(result, context) {
  const body = (result.text || '').replace(/\s+/g, ' ').trim().slice(0, 180);
  const lines = [`✗ 请求失败：HTTP ${result.status}${context ? `（${context}）` : ''}`];
  switch (result.status) {
    case 400:
      lines.push('  参数无效：过滤条件请用完整 ID，如 odpt.Operator:TokyoMetro / odpt.Railway:TokyoMetro.Tozai。');
      break;
    case 401:
      lines.push('  acl:consumerKey 不正确：密钥有误或已失效，请到 ' + SIGNUP_URL + ' 右上角 "Access token" 核对。');
      break;
    case 403:
      if (/Require/i.test(body)) {
        lines.push('  网关未收到密钥（Require acl:consumerKey.）：请检查密钥是否为空串、含引号/空格/换行。');
        printMissingKeyHelp(null); // 输出完整注册/配置步骤
      } else if (/Invalid/i.test(body)) {
        lines.push(`  密钥无效或已过期（Invalid acl:consumerKey）：请到 ${SIGNUP_URL} 右上角 "Access token" 重新复制 PRIMARY/SECONDARY key。`);
      } else {
        lines.push(`  无访问权限：请确认已在 ${SIGNUP_URL} 注册并开通数据访问权限。`);
      }
      break;
    case 404:
      lines.push('  没有符合条件的数据：请检查运营公司/线路 ID 拼写（或去掉过滤条件重试）。');
      break;
    case 405:
      lines.push('  HTTP 方法不允许：本 API 仅支持 GET。');
      break;
    case 429:
      lines.push('  触发限流（额度 60 次/分 · 3600 次/时 · 24000 次/日）：请稍后重试，或用 --operator/--railway 收窄以减少请求。');
      break;
    case 500:
    case 502:
    case 503:
    case 504:
      lines.push('  服务端暂时不可用：请稍后重试。');
      break;
    default:
      lines.push('  非预期的 HTTP 状态码，请稍后重试。');
  }
  const rl = rateLimitInfo(result.headers);
  if (rl) lines.push(`  限流余量：${rl}`);
  if (body) lines.push(`  响应片段：${body}`);
  return lines;
}

function rateLimitInfo(headers) {
  if (!headers || typeof headers.forEach !== 'function') return null;
  const parts = [];
  headers.forEach((v, k) => {
    if (/^x-ratelimit/i.test(k)) parts.push(`${k}=${v}`);
  });
  return parts.length ? parts.join(' ') : null;
}

/* ------------------------------------------------------------------ *
 * 数据获取策略
 * ------------------------------------------------------------------ */

const asArray = (v) => (Array.isArray(v) ? v : []);

// 有 --operator/--railway → 单请求；否则按运营公司逐家检索（防服务端截断）
async function fetchMatchingStations(opts, key, log) {
  const filters = {};
  if (opts.operator) filters['odpt:operator'] = opts.operator;
  if (opts.railway) filters['odpt:railway'] = opts.railway;

  if (opts.operator || opts.railway) {
    const r = await apiGet(STATION_PATH, filters, key);
    if (!r.ok) throw new ApiError(r.status, describeHttpError(r, 'odpt:Station 过滤查询'), 'odpt:Station');
    return { stations: asArray(r.body), operatorsTried: 0, operatorTitles: {}, rate: rateLimitInfo(r.headers) };
  }

  log('· 未指定 --operator/--railway：先取运营公司列表，再逐家检索（规避服务端输出上限截断）');
  const opRes = await apiGet(OPERATOR_PATH, {}, key);
  if (!opRes.ok) throw new ApiError(opRes.status, describeHttpError(opRes, 'odpt:Operator 列表'), 'odpt:Operator');

  const operators = [];
  const operatorTitles = {};
  for (const o of asArray(opRes.body)) {
    const id = (typeof o === 'object' && o) ? (o['owl:sameAs'] || o['@id']) : null;
    if (typeof id === 'string' && id.startsWith('odpt.Operator:')) {
      operators.push(id);
      const t = o['odpt:operatorTitle'];
      if (t && typeof t === 'object' && typeof t.ja === 'string') operatorTitles[id] = t.ja;
      else if (typeof o['dc:title'] === 'string') operatorTitles[id] = o['dc:title'];
    }
  }

  if (!operators.length) {
    log('· 运营公司列表为空，退化为全量单次查询（结果可能被服务端截断）');
    const r = await apiGet(STATION_PATH, {}, key);
    if (!r.ok) throw new ApiError(r.status, describeHttpError(r, 'odpt:Station 全量查询'), 'odpt:Station');
    return { stations: asArray(r.body), operatorsTried: 0, operatorTitles, rate: rateLimitInfo(r.headers) };
  }

  const collected = [];
  let tried = 0;
  const failures = [];
  outer: for (let i = 0; i < operators.length; i += FANOUT_CONCURRENCY) {
    const batch = operators.slice(i, i + FANOUT_CONCURRENCY);
    const results = await Promise.all(
      batch.map((op) =>
        apiGet(STATION_PATH, { 'odpt:operator': op }, key).then(
          (r) => ({ op, r }),
          (e) => ({ op, r: null, e })
        )
      )
    );
    for (const { op, r, e } of results) {
      tried++;
      if (e) {
        failures.push(`${op}: ${e.message}`);
        continue;
      }
      if (!r.ok) {
        failures.push(`${op}: HTTP ${r.status}`);
        if (r.status === 401 || r.status === 403 || r.status === 429) {
          // 鉴权/限流类失败对全部请求同样成立，直接中止
          throw new ApiError(r.status, describeHttpError(r, `${op} 车站列表`), 'odpt:Station');
        }
        continue;
      }
      for (const s of asArray(r.body)) collected.push(s);
    }
    // 注意：这里不能按 opts.limit 提前 break——服务端单请求上限约 100 条，
    // 每家运营公司的车站列表也可能被截断，早停会导致后面的运营公司
    // (如 JR East、TokyoMetro) 根本不被查询，站名搜索漏结果。
    // 必须遍历完全部运营公司后再在客户端做匹配与展示截断。
  }
  if (failures.length && !collected.length && tried === failures.length) {
    log(`✗ ${failures.length}/${tried} 家运营公司查询失败：\n  ${failures.slice(0, 5).join('\n  ')}`);
    throw new Error(`全部 ${tried} 家运营公司的车站查询均失败`);
  }
  if (failures.length) log(`· 提示：${failures.length}/${tried} 家运营公司查询失败已跳过（${failures[0]} …）`);
  return { stations: collected, operatorsTried: tried, operatorTitles, rate: rateLimitInfo(opRes.headers) };
}

/* ------------------------------------------------------------------ *
 * 多语言标题与匹配
 * ------------------------------------------------------------------ */

function collectTitles(station) {
  const out = [];
  const t = station['odpt:stationTitle'];
  if (t && typeof t === 'object' && !Array.isArray(t)) {
    const keys = [
      ...PREFERRED_LANGS,
      ...Object.keys(t)
        .filter((k) => !PREFERRED_LANGS.includes(k))
        .sort(),
    ];
    for (const k of keys) {
      const v = t[k];
      if (typeof v === 'string' && v.trim()) out.push({ lang: k, text: v.trim() });
    }
  }
  if (!out.length && typeof station['dc:title'] === 'string' && station['dc:title'].trim()) {
    out.push({ lang: 'dc:title', text: station['dc:title'].trim() }); // 兜底
  }
  return out;
}

function buildNeedles(keyword) {
  const kw = keyword.trim();
  const needles = [kw.toLowerCase()];
  const stripped = kw.replace(/[駅站]$/, ''); // "新宿駅/新宿站" → "新宿"
  if (stripped && stripped !== kw) needles.push(stripped.toLowerCase());
  return needles;
}

// 0=任一语言精确命中 1=前缀命中 2=包含命中 Infinity=不命中
function scoreStation(station, needles) {
  let best = Infinity;
  for (const { text } of collectTitles(station)) {
    const tl = text.toLowerCase();
    for (const n of needles) {
      if (tl === n) best = Math.min(best, 0);
      else if (tl.startsWith(n)) best = Math.min(best, 1);
      else if (tl.includes(n)) best = Math.min(best, 2);
    }
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * 输出
 * ------------------------------------------------------------------ */

const fmtScalar = (v) => {
  if (Array.isArray(v)) return v.length ? v.join(' / ') : '-';
  return v === undefined || v === null || v === '' ? '-' : String(v);
};

function renderStation(idx, station, operatorTitles) {
  const titles = collectTitles(station);
  const titleLine = titles.map((t) => `${t.text} (${t.lang})`).join(' | ');
  const lines = [`[${idx}] ${titleLine || '(无多语言站名)'}`];
  const op = station['odpt:operator'];
  const opTitle = op && operatorTitles[op] ? ` （${operatorTitles[op]}）` : '';
  lines.push(`    odpt:operator          : ${fmtScalar(op)}${opTitle}`);
  lines.push(`    odpt:railway           : ${fmtScalar(station['odpt:railway'])}`);
  const cr = station['odpt:connectingRailway'];
  if (Array.isArray(cr) && cr.length) lines.push(`    odpt:connectingRailway : ${cr.join(', ')}`);
  lines.push(`    odpt:stationCode       : ${fmtScalar(station['odpt:stationCode'])}`);
  lines.push(`    geo:lat / geo:long     : ${fmtScalar(station['geo:lat'])}, ${fmtScalar(station['geo:long'])}`);
  lines.push(`    @id                    : ${fmtScalar(station['@id'])}`);
  const same = station['owl:sameAs'];
  if (same) lines.push(`    owl:sameAs             : ${same}`); // 后续查询用的规范站 ID
  return lines.join('\n');
}

function printNoMatchAdvice(keyword, scanned) {
  console.error(`✗ 未找到与 “${keyword}” 匹配的车站${scanned ? `（共检查 ${scanned} 条车站数据）` : ''}。`);
  console.error('建议：');
  console.error('  · 换用别名/其他写法，或直接用英文站名，如 shinjuku / shibuya / tokyo / ueno');
  console.error('  · 中文可用简体（东京、新宿、涩谷），数据含 zh-Hans/zh-Hant；日文原名亦可（渋谷、東京）');
  console.error('  · 关键词过短会命中大量结果被 --limit 截断；过长可去掉「駅/站」等后缀重试');
  console.error('  · 指定 --operator / --railway 可缩小范围并规避服务端输出截断，提高命中率');
}

function printHelp() {
  console.log(`ODPT 车站检索 — 东京公共交通开放数据中心（Public Transportation Open Data Center）

用法：
  node scripts/odpt_station.js <站名关键词> [选项]

参数：
  <站名关键词>    不区分大小写的包含匹配，作用于每站 odpt:stationTitle
                  多语言对象（ja / en / zh-Hans / zh-Hant / ko 等）

选项：
  --operator <ID>  按运营公司过滤，如 odpt.Operator:TokyoMetro（可简写 TokyoMetro）
  --railway  <ID>  按线路过滤，如 odpt.Railway:TokyoMetro.Marunouchi（可简写 TokyoMetro.Marunouchi）
  --limit <N>      最多显示 N 条命中（默认 10；客户端展示上限，非服务端分页）
  --full           输出命中车站的原始 JSON 字段（stdout 仅 JSON，便于管道处理）
  -h, --help       显示本帮助

密钥（二选一，绝不回显）：
  1) 环境变量  export ODPT_API_KEY="你的key"
  2) 密钥文件  /data/secrets/odpt.env（一行 ODPT_API_KEY=你的key，建议权限 600）
  免费注册：${SIGNUP_URL}（Sign up 后，右上角 "Access token" 查看 PRIMARY/SECONDARY key）

示例：
  node scripts/odpt_station.js 新宿
  node scripts/odpt_station.js shinjuku --operator odpt.Operator:JR-East
  node scripts/odpt_station.js 五反田 --railway Tokyu.Ikegami --limit 3
  node scripts/odpt_station.js 渋谷 --full

说明：
  · 数据源 ${API_BASE}/${STATION_PATH}（API v4，文档版本 4.16）
  · 鉴权仅支持 query 参数 acl:consumerKey（无 header 方式）
  · 官方 limit 参数是输出上限截断保护，非分页（无 offset/page）；
    未指定 --operator/--railway 时本脚本按运营公司逐家检索以避免截断丢数据
  · 限流（共享额度）：60 次/分 · 3600 次/时 · 24000 次/日
  · 退出码：0=有匹配；1=无匹配或请求失败（含缺 key 的网关 403）；2=参数错误`);
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return 0;
  }
  if (opts.errors.length) {
    for (const e of opts.errors) console.error(`✗ ${e}`);
    console.error('用法：node scripts/odpt_station.js <站名关键词> [--operator ID] [--railway ID] [--limit N] [--full]（-h 查看完整帮助）');
    return 2;
  }

  const { key, source, mode } = loadApiKey();
  if (key) {
    console.error(`· 密钥来源：${source}（值不回显）`);
  } else {
    // 缺 key 不本地短路：照常发真实请求，由网关 403 Require 兜底并给出配置指引
    console.error(`⚠ 未找到 ODPT API 密钥（${source || '环境变量 ODPT_API_KEY 与 ' + KEY_FILE + ' 均为空'}），本次请求预期 403 Require acl:consumerKey.`);
  }
  if (mode !== null && (mode & 0o077) !== 0) {
    console.error(`⚠ 密钥文件 ${KEY_FILE} 权限过宽（建议 chmod 600）`);
  }

  const log = (msg) => console.error(msg);
  const started = Date.now();
  let fetched;
  try {
    fetched = await fetchMatchingStations(opts, key, log);
  } catch (err) {
    if (err instanceof ApiError) {
      for (const l of err.lines) console.error(l);
    } else {
      console.error(`✗ ${err.message || err}`);
    }
    return 1;
  }

  const needles = buildNeedles(opts.keyword);
  const matches = [];
  for (const s of fetched.stations) {
    if (!s || typeof s !== 'object') continue;
    const score = scoreStation(s, needles);
    if (score < Infinity) matches.push({ station: s, score });
  }
  matches.sort((a, b) => a.score - b.score); // 精确命中 > 前缀 > 包含（排序稳定）

  if (!matches.length) {
    printNoMatchAdvice(opts.keyword, fetched.stations.length);
    return 1;
  }

  const shown = matches.slice(0, opts.limit);
  if (opts.full) {
    console.log(JSON.stringify(shown.map((m) => m.station), null, 2));
  } else {
    shown.forEach((m, i) => console.log(renderStation(i + 1, m.station, fetched.operatorTitles)));
    console.error(`— 命中 ${matches.length} 条${matches.length > shown.length ? `，显示前 ${shown.length} 条` : ''}（--limit 调整数量，--full 输出原始 JSON）`);
  }

  const bits = [`耗时 ${Date.now() - started}ms`];
  if (fetched.operatorsTried) bits.push(`扫描 ${fetched.operatorsTried} 家运营公司 / ${fetched.stations.length} 条车站数据`);
  if (fetched.rate) bits.push(`限流余量 ${fetched.rate}`);
  console.error(`· 完成：${bits.join('；')}`);
  return 0;
}

if (require.main === module) {
  main()
    .then((code) => {
      if (code) process.exitCode = code;
    })
    .catch((e) => {
      console.error('✗ 未预期的错误：', (e && e.stack) || e);
      process.exitCode = 1;
    });
} else {
  // 供测试/复用：不触发 CLI 主流程
  module.exports = { parseArgs, loadApiKey, collectTitles, buildNeedles, scoreStation, normalizeId, renderStation };
}

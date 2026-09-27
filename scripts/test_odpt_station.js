// 端到端自测：mock 全局 fetch，无需网络与真实密钥
// 运行：node test_odpt_station.js
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TARGET = path.join(__dirname, 'odpt_station.js');
const PRELOAD = path.join(os.tmpdir(), 'odpt_preload.js');
const CALLS = path.join(os.tmpdir(), 'odpt_calls.log');

// ---- 自包含 mock 工厂（会被序列化进子进程，不得引用外部闭包）----
const makeFetch = (config) => {
  const fs = require('node:fs'); // 自包含：被序列化进子进程 preload 时仍可用
  const cfg = config || {};
  const stationsByOp = cfg.stationsByOp || {};
  const operators = cfg.operators || [];
  const failStationWith = cfg.failStationWith || null;
  const resp = (status, body, contentType) => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: { forEach: (fn) => new Map([['content-type', contentType], ['x-ratelimit-remaining-minute', '59']]).forEach(fn) },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  return async (input) => {
    const url = new URL(input.url || input);
    if (cfg.callsFile) fs.appendFileSync(cfg.callsFile, JSON.stringify({ p: url.pathname, q: Object.fromEntries(url.searchParams.entries()) }) + '\n');
    const key = url.searchParams.get('acl:consumerKey');
    if (!key) return resp(403, 'Require acl:consumerKey.', 'text/html');
    if (key === 'BAD') return resp(403, 'Invalid acl:consumerKey.', 'text/html');
    if (failStationWith) return resp(failStationWith, 'boom', 'text/html');
    if (url.pathname.endsWith('/odpt:Operator')) return resp(200, operators, 'application/json');
    if (url.pathname.endsWith('/odpt:Station')) {
      const op = url.searchParams.get('odpt:operator');
      const rl = url.searchParams.get('odpt:railway');
      let list = op ? stationsByOp[op] || [] : Object.values(stationsByOp).flat();
      if (rl) list = list.filter((s) => s['odpt:railway'] === rl);
      return resp(200, list, 'application/json');
    }
    return resp(404, 'not found', 'text/plain');
  };
};

// ---- 夹具 ----
const station = (o) => ({ '@context': 'http://vocab.odpt.org/context_odpt.jsonld', '@type': 'odpt:Station', ...o });
const CFG = {
  operators: [
    { '@type': 'odpt:Operator', '@id': 'urn:ucode:op1', 'owl:sameAs': 'odpt.Operator:TokyoMetro',
      'dc:title': '東京メトロ', 'odpt:operatorTitle': { ja: '東京メトロ', en: 'Tokyo Metro' } },
    { '@type': 'odpt:Operator', '@id': 'urn:ucode:op2', 'owl:sameAs': 'odpt.Operator:JR-East',
      'dc:title': 'JR東日本', 'odpt:operatorTitle': { ja: 'JR東日本', en: 'JR East' } },
    { '@type': 'odpt:Operator', '@id': 'urn:ucode:op3', 'owl:sameAs': 'odpt.Operator:Tama',
      'dc:title': '多摩モノレール', 'odpt:operatorTitle': { ja: '多摩モノレール', en: 'Tama Monorail' } },
    { '@type': 'odpt:Operator', '@id': 'urn:ucode:op4', 'owl:sameAs': 'odpt.Operator:Toei',
      'dc:title': '都営地下鉄', 'odpt:operatorTitle': { ja: '都営地下鉄', en: 'Toei Subway' } },
    { '@type': 'odpt:Operator', '@id': 'urn:ucode:op5', 'owl:sameAs': 'odpt.Operator:Keio',
      'dc:title': '京王電鉄', 'odpt:operatorTitle': { ja: '京王電鉄', en: 'Keio Corporation' } },
    { '@type': 'odpt:Operator', '@id': 'urn:ucode:op6', 'owl:sameAs': 'odpt.Operator:Tokyu',
      'dc:title': '東京急行電鉄', 'odpt:operatorTitle': { ja: '東京急行電鉄', en: 'Tokyu Corporation' } },
  ],
  stationsByOp: {
    'odpt.Operator:TokyoMetro': [
      station({
        '@id': 'urn:ucode:_00001C000000000000010000030FD5D6',
        'owl:sameAs': 'odpt.Station:TokyoMetro.Marunouchi.Shinjuku',
        'dc:title': '新宿',
        'odpt:stationTitle': { ja: '新宿', en: 'Shinjuku', 'zh-Hans': '新宿', 'zh-Hant': '新宿', ko: '신주쿠' },
        'odpt:operator': 'odpt.Operator:TokyoMetro',
        'odpt:railway': 'odpt.Railway:TokyoMetro.Marunouchi',
        'odpt:connectingRailway': ['odpt.Railway:JR-East.Yamanote', 'odpt.Railway:JR-East.ChuoRapid'],
        'odpt:stationCode': 'M-08',
        'geo:lat': 35.689592, 'geo:long': 139.700432,
      }),
      station({
        '@id': 'urn:ucode:_00001C000000000000010000030FD5D7',
        'owl:sameAs': 'odpt.Station:TokyoMetro.Ginza.Shibuya',
        'dc:title': '渋谷',
        'odpt:stationTitle': { ja: '渋谷', en: 'Shibuya', 'zh-Hans': '涩谷', 'zh-Hant': '澀谷' },
        'odpt:operator': 'odpt.Operator:TokyoMetro',
        'odpt:railway': 'odpt.Railway:TokyoMetro.Ginza',
        'odpt:stationCode': 'G-01',
        'geo:lat': 35.658072, 'geo:long': 139.701773,
      }),
      station({
        '@id': 'urn:ucode:_00001C000000000000010000030FD5D8',
        'owl:sameAs': 'odpt.Station:TokyoMetro.Ginza.ShinjukuGyoemmae',
        'dc:title': '新宿御苑前',
        'odpt:stationTitle': { ja: '新宿御苑前', en: 'Shinjuku-gyoemmae' },
        'odpt:operator': 'odpt.Operator:TokyoMetro',
        'odpt:railway': 'odpt.Railway:TokyoMetro.Ginza',
        'odpt:stationCode': 'M-10',
        'geo:lat': 35.687674, 'geo:long': 139.71037,
      }),
    ],
    'odpt.Operator:JR-East': [
      station({
        '@id': 'urn:ucode:_00001C000000000000010000030FD5E1',
        'owl:sameAs': 'odpt.Station:JR-East.Yamanote.Shinjuku',
        'dc:title': '新宿',
        'odpt:stationTitle': { ja: '新宿', en: 'Shinjuku', 'zh-Hans': '新宿' },
        'odpt:operator': 'odpt.Operator:JR-East',
        'odpt:railway': 'odpt.Railway:JR-East.Yamanote',
        'odpt:stationCode': 'JY-17',
        'geo:lat': 35.689671, 'geo:long': 139.700467,
      }),
      station({
        '@id': 'urn:ucode:_00001C000000000000010000030FD5E2',
        'owl:sameAs': 'odpt.Station:JR-East.Yamanote.Yoyogi',
        'dc:title': '代々木',
        'odpt:stationTitle': { ja: '代々木', en: 'Yoyogi' },
        'odpt:operator': 'odpt.Operator:JR-East',
        'odpt:railway': 'odpt.Railway:JR-East.Yamanote',
        'odpt:stationCode': 'JY-18',
        'geo:lat': 35.681263, 'geo:long': 139.702292,
      }),
    ],
    'odpt.Operator:Tama': [
      station({
        '@id': 'urn:ucode:_00001C000000000000010000030FD5E3',
        'owl:sameAs': 'odpt.Station:Tama.TamaMonorail.TamaCenter',
        'dc:title': '多摩センター',
        'odpt:stationTitle': { ja: '多摩センター', en: 'Tama-center' },
        'odpt:operator': 'odpt.Operator:Tama',
        'odpt:railway': 'odpt.Railway:Tama.TamaMonorail',
        'odpt:stationCode': 'TT17',
        'geo:lat': 35.629121, 'geo:long': 139.415847,
      }),
    ],
    'odpt.Operator:Toei': [
      station({
        '@id': 'urn:ucode:_00001C000000000000010000030FD5E4',
        'owl:sameAs': 'odpt.Station:Toei.Oedo.Daimon',
        'dc:title': '大門',
        'odpt:stationTitle': { ja: '大門', en: 'Daimon' },
        'odpt:operator': 'odpt.Operator:Toei',
        'odpt:railway': 'odpt.Railway:Toei.Oedo',
        'odpt:stationCode': 'E-20',
        'geo:lat': 35.657243, 'geo:long': 139.756285,
      }),
    ],
    'odpt.Operator:Keio': [
      station({
        '@id': 'urn:ucode:_00001C000000000000010000030FD5E5',
        'owl:sameAs': 'odpt.Station:Keio.Keio.Takaosanguchi',
        'dc:title': '高尾山口',
        'odpt:stationTitle': { ja: '高尾山口', en: 'Takaosanguchi' },
        'odpt:operator': 'odpt.Operator:Keio',
        'odpt:railway': 'odpt.Railway:Keio.Keio',
        'odpt:stationCode': 'KO53',
        'geo:lat': 35.642344, 'geo:long': 139.259855,
      }),
    ],
    'odpt.Operator:Tokyu': [
      station({
        '@id': 'urn:ucode:_00001C000000000000010000030FD5E6',
        'owl:sameAs': 'odpt.Station:Tokyu.Toyoko.Jiyugaoka',
        'dc:title': '自由が丘',
        'odpt:stationTitle': { ja: '自由が丘', en: 'Jiyugaoka' },
        'odpt:operator': 'odpt.Operator:Tokyu',
        'odpt:railway': 'odpt.Railway:Tokyu.Toyoko',
        'odpt:stationCode': 'TY10',
        'geo:lat': 35.607532, 'geo:long': 139.668078,
      }),
    ],
  },
};

// ---- 运行器：序列化 makeFetch 进 preload，调用记录经临时文件回传 ----
function run(args, { config = CFG, fetchFn = null, env = {}, expectCalls = false } = {}) {
  try { fs.unlinkSync(CALLS); } catch {}
  const cfg = expectCalls ? { ...config, callsFile: CALLS } : config;
  const fn = fetchFn ? fetchFn.toString() : `(${makeFetch.toString()})(${JSON.stringify(cfg)})`;
  fs.writeFileSync(PRELOAD, `globalThis.fetch = ${fn};\n`);
  const r = spawnSync(process.execPath, ['--require', PRELOAD, TARGET, ...args], {
    cwd: __dirname, encoding: 'utf8', env: { ...process.env, ODPT_API_KEY: 'TESTKEY', ...env },
  });
  fs.unlinkSync(PRELOAD);
  let calls = [];
  if (expectCalls) { try { calls = fs.readFileSync(CALLS, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); fs.unlinkSync(CALLS); } catch {} }
  return { code: r.status, out: r.stdout, err: r.stderr, calls };
}

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? `\n      ${String(detail).split('\n').join('\n      ')}` : ''}`); }
};

console.log('== E2E: 基本检索（ja/en/zh 多语言匹配）==');
{
  const r = run(['新宿'], { expectCalls: true });
  check('退出码 0', r.code === 0, `code=${r.code}\n${r.err}`);
  check('多语言命中：新宿(ja)+Shinjuku(en)+신주쿠(ko)+新宿御苑前(包含)', /新宿御苑前/.test(r.out) && /Shinjuku/.test(r.out), r.out);
  check('多语言站名带语言标签', /新宿 \(ja\).*Shinjuku \(en\).*新宿 \(zh-Hans\).*신주쿠 \(ko\)/s.test(r.out), r.out);
  check('输出 operator/railway/stationCode/坐标/@id', /odpt:operator/.test(r.out) && /odpt:railway/.test(r.out) && /odpt:stationCode\s+: M-08/.test(r.out) && /35\.689592, 139\.700432/.test(r.out) && /@id\s+: urn:ucode:/.test(r.out), r.out);
  check('connectingRailway 仅在存在时输出', /odpt:connectingRailway : odpt\.Railway:JR-East\.Yamanote, odpt\.Railway:JR-East\.ChuoRapid/.test(r.out), r.out);
  check('owl:sameAs 一并输出', /owl:sameAs\s+: odpt\.Station:TokyoMetro\.Marunouchi\.Shinjuku/.test(r.out), r.out);
  check('所有请求都带 acl:consumerKey', r.calls.length > 0 && r.calls.every((c) => c.q['acl:consumerKey'] === 'TESTKEY'), JSON.stringify(r.calls));
  check('stdout/stderr 均不含密钥值', !r.out.includes('TESTKEY') && !r.err.includes('TESTKEY'));
  check('未指定过滤时按运营公司 fan-out', r.calls.some((c) => c.q['odpt:operator'] === 'odpt.Operator:TokyoMetro'));
}

console.log('== E2E: 不区分大小写 & 后缀降级 ==');
{
  const r = run(['SHINJUKU']);
  check('英文大写可命中', r.code === 0 && /Shinjuku/.test(r.out), r.out + r.err);
  const r2 = run(['新宿駅']);
  check('「新宿駅」自动降级匹配「新宿」', r2.code === 0 && r2.out.includes('新宿'), r2.out + r2.err);
}

console.log('== E2E: 排序（精确>前缀>包含）与 --limit ==');
{
  const r = run(['新宿', '--limit', '1']);
  const first = (r.out.match(/^\[1\] .*/) || [''])[0];
  check('精确命中排最前', /^\[1\] 新宿 \(ja\)/.test(first), first);
  check('--limit 1 只显示 1 条', (r.out.match(/^\[\d+\] /gm) || []).length === 1, r.out);
  check('stderr 提示被截断数量', /命中 3 条，显示前 1 条/.test(r.err), r.err);
}

console.log('== E2E: 多运营公司 fan-out 进度（全量遍历，不提前收手）==');
{
  const r = run(['新宿', '--limit', '1'], { expectCalls: true });
  const stCalls = r.calls.filter((c) => c.p.endsWith('odpt:Station'));
  const fanoutOps = stCalls.map((c) => c.q['odpt:operator']);
  // 回归：曾因凑够 --limit 提前 break 导致后批运营公司(Keio/Tokyu)漏查 → 现必须全量遍历
  check('不提前收手：全部运营公司被查询（含后批 Keio/Tokyu）', stCalls.length >= 6 && fanoutOps.includes('odpt.Operator:Keio') && fanoutOps.includes('odpt.Operator:Tokyu'), JSON.stringify(fanoutOps));
  check('进度行可追踪（扫描 N 家运营公司）', /扫描 \d+ 家运营公司/.test(r.err), r.err);
}

console.log('== E2E: --operator / --railway 过滤与 ID 容错 ==');
{
  const r = run(['shinjuku', '--operator', 'TokyoMetro'], { expectCalls: true });
  check('简写 ID 自动补全为 odpt.Operator:TokyoMetro', r.calls.every((c) => !c.q['odpt:operator'] || c.q['odpt:operator'] === 'odpt.Operator:TokyoMetro'), JSON.stringify(r.calls.map((c) => c.q)));
  check('指定 operator 时单请求（不拉 operator 列表）', !r.calls.some((c) => c.p.endsWith('odpt:Operator')) && r.calls.length === 1, JSON.stringify(r.calls.map((c) => c.p)));
  const r2 = run(['shinjuku', '--railway', 'odpt.Railway:TokyoMetro.Ginza'], { expectCalls: true });
  check('--railway 过滤生效（仅 Ginza 线且含 shinjuku 的 1 站，丸之内线新宿被排除）', r2.code === 0 && (r2.out.match(/^\[\d+\] /gm) || []).length === 1 && /Shinjuku-gyoemmae/.test(r2.out) && !/Marunouchi\.Shinjuku/.test(r2.out), r2.out + r2.err);
  check('railway 请求单发且带过滤参数', r2.calls.length === 1 && r2.calls[0].q['odpt:railway'] === 'odpt.Railway:TokyoMetro.Ginza', JSON.stringify(r2.calls.map((c) => c.q)));
}

console.log('== E2E: --full 输出原始 JSON ==');
{
  const r = run(['渋谷', '--full']);
  let parsed = null;
  try { parsed = JSON.parse(r.out); } catch {}
  check('--full stdout 为可解析 JSON 数组', Array.isArray(parsed) && parsed.length === 1, r.out.slice(0, 200));
  check('保留原始字段结构', !!parsed && parsed[0]['odpt:stationTitle'].ja === '渋谷' && typeof parsed[0]['geo:lat'] === 'number' && !('odpt:connectingRailway' in parsed[0]));
}

console.log('== E2E: 无匹配建议 ==');
{
  const r = run(['没有这个站xyz']);
  check('退出码 1', r.code === 1);
  check('建议含英文站名示例与换词提示', /shinjuku \/ shibuya/.test(r.err) && /换用别名/.test(r.err), r.err);
}

console.log('== E2E: 错误路径不崩溃 ==');
{
  const r = run(['tokyo'], { config: { ...CFG, failStationWith: 403 }, env: { ODPT_API_KEY: 'BAD' } });
  check('403 Invalid → 状态码+建议+退出码 1', r.code === 1 && /HTTP 403/.test(r.err) && /Invalid acl:consumerKey/.test(r.err) && /Access token/.test(r.err), r.err);
  const r4 = run(['tokyo'], { config: { ...CFG, failStationWith: 404 } });
  check('404 → 无数据提示', r4.code === 1 && /HTTP 404/.test(r4.err), r4.err);
  const r5 = run(['tokyo'], { config: { ...CFG, failStationWith: 429 } });
  check('429 → 限流提示（60/分·3600/时·24000/日）', r5.code === 1 && /HTTP 429/.test(r5.err) && /24000/.test(r5.err), r5.err);
  const netFn = async () => { const e = new Error('x'); e.cause = { code: 'ENOTFOUND' }; throw e; };
  const rN = run(['tokyo'], { fetchFn: netFn });
  check('网络错误 → DNS 提示不崩溃', rN.code === 1 && /DNS 解析失败/.test(rN.err), rN.err);
}

console.log('== E2E: 密钥加载约定 ==');
{
  // 回归：缺 key 不再本地短路，而是照常发请求，由网关 403 Require 兜底（退出码 1）
  const rEnv = run(['tokyo'], { env: { ODPT_API_KEY: '' , ODPT_SECRETS_FILE: '/nonexistent-odpt.env'}, expectCalls: true });
  check('缺 key：仍发出真实请求且 URL 不带 acl:consumerKey 参数', rEnv.calls.length >= 1 && rEnv.calls.every((c) => !('acl:consumerKey' in c.q)), JSON.stringify(rEnv.calls));
  check('缺 key：HTTP 403 + Require 语义 + 完整配置指引 + 退出码 1', rEnv.code === 1 && /HTTP 403/.test(rEnv.err) && /Require acl:consumerKey/.test(rEnv.err) && /developer\.odpt\.org/.test(rEnv.err) && /Sign up/.test(rEnv.err), rEnv.err);
  const mod = require(TARGET);
  check('module.exports 导出可复用函数', ['parseArgs', 'loadApiKey', 'collectTitles', 'scoreStation', 'normalizeId'].every((k) => typeof mod[k] === 'function'));
  check('normalizeId 三种写法容错', mod.normalizeId('TokyoMetro', 'odpt.Operator:') === 'odpt.Operator:TokyoMetro' && mod.normalizeId('odpt.Operator:TokyoMetro', 'odpt.Operator:') === 'odpt.Operator:TokyoMetro' && mod.normalizeId('https://api.odpt.org/api/v4/odpt.Operator:x', 'odpt.Operator:') === 'https://api.odpt.org/api/v4/odpt.Operator:x');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exitCode = fail ? 1 : 0;

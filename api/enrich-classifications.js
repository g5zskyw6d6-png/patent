// =============================================================================
// api/enrich-classifications.js  ―  Vercel Function 版バックフィル(依存ゼロ)
// =============================================================================
// 1回の呼び出しで「少量バッチ(BATCH件)」だけ IPC/CPC を取り込み、すぐ返す。
// cron / 外部スケジューラから繰り返し叩くことで全件を埋める。
// classifications_fetched_at で取得済みを記録するので、何度叩いても続きから進む。
//
// ★この版は @supabase/supabase-js を使わず、Supabase REST API(PostgREST)を
//   素の fetch で叩く。外部パッケージ依存ゼロなので、関数バンドル不足
//   (ERR_MODULE_NOT_FOUND)が起きない。既存の epo proxy と同じ fetch 流儀。
//
// 配置: プロジェクト直下の  api/enrich-classifications.js
//
// 必要な環境変数(Vercel → Settings → Environment Variables):
//   既存を再利用(追加不要):
//     VITE_SUPABASE_URL
//     VITE_EPO_CONSUMER_KEY
//     VITE_EPO_CONSUMER_SECRET
//   新規に追加が必要:
//     SUPABASE_SERVICE_ROLE_KEY   ← サーバー側専用。VITE_ は絶対に付けない(必須)
//     CRON_SECRET                 ← 不正呼び出し防止(任意)
//
// ★要確認は元スクリプトと同じ [A]番号書式 / [B]JSONパス / [C]間隔
// =============================================================================

const BATCH = 3;
const REQUEST_DELAY_MS = 500;
const MAX_RETRY = 1;
const OPS_BASE = 'https://ops.epo.org/3.2';

// 試走時は1社に絞る。確認後は null に戻す(全社対象)。
const TEST_COMPANY_ID = null; // 全社対象(試走時は 'apple' 等のslugにする)

export const config = { maxDuration: 60 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const txt = (n) => (n && typeof n === 'object' && '$' in n ? n.$ : n);
const arr = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);
const normCode = (c) => (c || '').toUpperCase().replace(/\s+/g, '').trim();

// --- Supabase REST(PostgREST)ヘルパ ---------------------------------------
const SB_URL = () => process.env.VITE_SUPABASE_URL;
const SB_KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY;
function sbHeaders(extra = {}) {
  const key = SB_KEY();
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra };
}

// 未取得の特許を BATCH 件取得
async function fetchUnclassified() {
  let url = `${SB_URL()}/rest/v1/patents`
    + `?select=id,patent_number`
    + `&classifications_fetched_at=is.null`
    + `&patent_number=not.is.null`
    + `&limit=${BATCH}`;
  if (TEST_COMPANY_ID) url += `&company_id=eq.${encodeURIComponent(TEST_COMPANY_ID)}`;
  const res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`Supabase取得失敗: ${res.status} ${await res.text()}`);
  return res.json();
}

// 1件更新
async function updatePatent(id, cpc, ipc) {
  const url = `${SB_URL()}/rest/v1/patents?id=eq.${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: sbHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify({
      cpc: cpc.length ? cpc : null,
      ipc: ipc.length ? ipc : null,
      classifications_fetched_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) throw new Error(`更新失敗: ${res.status}`);
}

// 残件数
async function countRemaining() {
  let url = `${SB_URL()}/rest/v1/patents`
    + `?select=id&classifications_fetched_at=is.null&patent_number=not.is.null`;
  if (TEST_COMPANY_ID) url += `&company_id=eq.${encodeURIComponent(TEST_COMPANY_ID)}`;
  const res = await fetch(url, { headers: sbHeaders({ Prefer: 'count=exact', Range: '0-0' }) });
  const cr = res.headers.get('content-range') || '';   // 形式: 0-0/1234
  const total = cr.split('/')[1];
  return total ? Number(total) : null;
}

// --- OPS OAuth --------------------------------------------------------------
let accessToken = null;
let tokenExpiresAt = 0;
async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiresAt - 30_000) return accessToken;
  const basic = Buffer.from(`${process.env.VITE_EPO_CONSUMER_KEY}:${process.env.VITE_EPO_CONSUMER_SECRET}`).toString('base64');
  const res = await fetch(`${OPS_BASE}/auth/accesstoken`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`OPS認証失敗: ${res.status}`);
  const json = await res.json();
  accessToken = json.access_token;
  tokenExpiresAt = Date.now() + Number(json.expires_in || 1200) * 1000;
  return accessToken;
}

// --- 番号書式の候補を生成 [A] ----------------------------------------------
// OPSは末尾のkind code(A1/B2等)を付けるとヒットしないことが多い。
// kind codeを外した形を優先し、元の形も保険で試す。重複は除く。
function numberVariants(raw) {
  const n = (raw || '').trim().toUpperCase().replace(/\s+/g, '');
  const variants = [];
  // 末尾 kind code(英字+任意数字, 例 A1/B2/A)を除いた形
  const noKind = n.replace(/[A-Z]\d?$/, '');
  if (noKind && noKind !== n) variants.push(noKind);
  variants.push(n); // 元の形(kind code付き)も保険で
  return [...new Set(variants)];
}

// --- biblio取得(番号書式 × epodoc→docdb の順に試す) ------------------------
async function fetchBiblio(patentNumber) {
  for (const num of numberVariants(patentNumber)) {
    for (const format of ['epodoc', 'docdb']) {
      const url = `${OPS_BASE}/rest-services/published-data/publication/${format}/${encodeURIComponent(num)}/biblio`;
      for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
        const token = await getAccessToken();
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
        if (res.ok) return res.json();
        if (res.status === 401) { accessToken = null; continue; }
        if (res.status === 403 || res.status === 429) { await sleep(REQUEST_DELAY_MS * 2 ** (attempt + 1)); continue; }
        break; // 404等はこの書式を諦めて次へ
      }
    }
  }
  return null;
}

// --- CPC/IPC抽出 [B] --------------------------------------------------------
function parseClassifications(json) {
  const cpc = new Set(), ipc = new Set();
  try {
    for (const doc of arr(json?.['ops:world-patent-data']?.['exchange-documents']?.['exchange-document'])) {
      const biblio = doc?.['bibliographic-data'];
      if (!biblio) continue;
      for (const pc of arr(biblio?.['patent-classifications']?.['patent-classification'])) {
        const scheme = pc?.['classification-scheme']?.['@scheme'];
        if (scheme && String(scheme).toUpperCase() !== 'CPC') continue;
        const sec = txt(pc?.section) || '', cls = txt(pc?.class) || '', sub = txt(pc?.subclass) || '';
        const mg = txt(pc?.['main-group']) || '', sg = txt(pc?.subgroup) || '';
        if (sec && cls && sub && mg) cpc.add(normCode(`${sec}${cls}${sub}${mg}/${sg}`));
      }
      for (const ic of arr(biblio?.['classifications-ipcr']?.['classification-ipcr'])) {
        const m = (txt(ic?.text) || '').match(/^([A-H]\d{2}[A-Z]\s*\d+\/\s*\d+)/);
        if (m) ipc.add(normCode(m[1]));
      }
    }
  } catch { /* パース不能はスキップ */ }
  return { cpc: [...cpc], ipc: [...ipc] };
}

// --- ハンドラ ---------------------------------------------------------------
export default async function handler(req, res) {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (!SB_URL() || !SB_KEY()) {
    return res.status(500).json({ error: 'env missing', has_url: !!SB_URL(), has_service_role: !!SB_KEY() });
  }

  try {
    const rows = await fetchUnclassified();
    if (!rows.length) return res.status(200).json({ processed: 0, remaining: 0, done: true });

    let withCodes = 0, empty = 0, failed = 0;
    for (const row of rows) {
      let cpc = [], ipc = [];
      try {
        const json = await fetchBiblio(row.patent_number);
        if (json) ({ cpc, ipc } = parseClassifications(json));
        await updatePatent(row.id, cpc, ipc);
        if (cpc.length || ipc.length) withCodes++; else empty++;
      } catch (e) {
        failed++;
      }
      await sleep(REQUEST_DELAY_MS);
    }

    const remaining = await countRemaining();
    return res.status(200).json({ processed: rows.length, withCodes, empty, failed, remaining });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}

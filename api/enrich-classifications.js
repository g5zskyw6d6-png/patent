// =============================================================================
// api/enrich-classifications.js  ―  Vercel Function 版バックフィル
// =============================================================================
// 1回の呼び出しで「少量バッチ(BATCH件)」だけ IPC/CPC を取り込み、すぐ返す。
// cron / 外部スケジューラから繰り返し叩くことで全件を埋める。
// classifications_fetched_at で取得済みを記録するので、何度叩いても続きから進む。
//
// 配置: プロジェクト直下の  api/enrich-classifications.js
//       (Vite製SPAでもVercelは api/ 配下を関数としてデプロイする)
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

import { createClient } from '@supabase/supabase-js';

// 1呼び出しの処理件数。関数タイムアウト内に収める(下の maxDuration と整合)。
const BATCH = 25;
const REQUEST_DELAY_MS = 500;
const MAX_RETRY = 3;
const OPS_BASE = 'https://ops.epo.org/3.2';

// Fluid Compute での最大実行時間(秒)。Pro なら 300 まで上げてBATCHも増やせる。
export const config = { maxDuration: 60 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const txt = (n) => (n && typeof n === 'object' && '$' in n ? n.$ : n);
const arr = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);
const normCode = (c) => (c || '').toUpperCase().replace(/\s+/g, '').trim();

// --- OPS OAuth(ウォームインスタンス内で使い回す) ---------------------------
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

// --- biblio取得(epodoc→docdb フォールバック) [A] -------------------------
async function fetchBiblio(patentNumber) {
  for (const format of ['epodoc', 'docdb']) {
    const url = `${OPS_BASE}/rest-services/published-data/publication/${format}/${encodeURIComponent(patentNumber)}/biblio`;
    for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
      const token = await getAccessToken();
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
      if (res.ok) return res.json();
      if (res.status === 401) { accessToken = null; continue; }
      if (res.status === 403 || res.status === 429) { await sleep(REQUEST_DELAY_MS * 2 ** (attempt + 1)); continue; }
      break;
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
  // 不正呼び出し防止: CRON_SECRET を設定していれば Bearer 一致を要求
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: rows, error } = await supabase
    .from('patents')
    .select('id, patent_number')
    .is('classifications_fetched_at', null)
    .not('patent_number', 'is', null)
    // .eq('company_id', 'apple')  // ← 試走時はこの1行で1社に絞る。確認後に削除
    .limit(BATCH);

  if (error) return res.status(500).json({ error: error.message });
  if (!rows?.length) return res.status(200).json({ processed: 0, remaining: 0, done: true });

  let withCodes = 0, empty = 0, failed = 0;
  for (const row of rows) {
    let cpc = [], ipc = [];
    try {
      const json = await fetchBiblio(row.patent_number);
      if (json) ({ cpc, ipc } = parseClassifications(json));
    } catch { failed++; }
    const { error: upErr } = await supabase.from('patents').update({
      cpc: cpc.length ? cpc : null,
      ipc: ipc.length ? ipc : null,
      classifications_fetched_at: new Date().toISOString(),
    }).eq('id', row.id);
    if (upErr) failed++;
    else if (cpc.length || ipc.length) withCodes++;
    else empty++;
    await sleep(REQUEST_DELAY_MS);
  }

  // 残件数を返す(0になったら完了。cronはそのまま回しても no-op で安全)
  const { count: remaining } = await supabase
    .from('patents')
    .select('id', { count: 'exact', head: true })
    .is('classifications_fetched_at', null)
    .not('patent_number', 'is', null);

  return res.status(200).json({ processed: rows.length, withCodes, empty, failed, remaining });
}

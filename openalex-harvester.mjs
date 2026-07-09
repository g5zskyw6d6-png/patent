#!/usr/bin/env node
// =============================================================================
// OpenAlex 論文ハーベスタ (フェーズ3: 試験取り込み)
// =============================================================================
// 指定企業のOpenAlex機関IDで論文を取得し、Supabase openalex.works に格納する。
//
// 使い方:
//   export OPENALEX_API_KEY=your_key
//   export SUPABASE_URL=https://oqttbviuzlpggetmvkgi.supabase.co
//   export SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
//   node openalex-harvester.mjs
//
// デフォルト: NVIDIA, 2022-2024年
// =============================================================================

// ---------------------------------------------------------------------------
// 設定
// ---------------------------------------------------------------------------
const CONFIG = {
  // 取り込み対象企業
  companySlug: "nvidia",
  institutionIds: ["I4210127875"],  // NVIDIA (US)
  yearFrom: 2022,
  yearTo: 2024,

  // OpenAlex
  oaBaseUrl: "https://api.openalex.org",
  oaApiKey: process.env.OPENALEX_API_KEY || "",
  oaPerPage: 100,
  oaDelayMs: 150,  // リクエスト間隔

  // Supabase
  sbUrl: process.env.SUPABASE_URL || "https://oqttbviuzlpggetmvkgi.supabase.co",
  sbKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  sbBatchSize: 50,  // 1回のINSERTで入れる件数
};

// ---------------------------------------------------------------------------
// ユーティリティ
// ---------------------------------------------------------------------------
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// abstract_inverted_index → プレーンテキストに復元
function reconstructAbstract(invertedIndex) {
  if (!invertedIndex) return null;
  const words = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) {
      words[pos] = word;
    }
  }
  return words.join(" ");
}

// OpenAlex work → DB行に変換
function transformWork(work, companySlug) {
  // トピック抽出(上位5件)
  const topics = (work.topics || []).slice(0, 5).map(t => ({
    id: t.id?.replace("https://openalex.org/", ""),
    display_name: t.display_name,
    score: t.score,
    subfield: t.subfield?.display_name,
    field: t.field?.display_name,
    domain: t.domain?.display_name,
  }));

  // 著者の所属機関ID一覧(重複除去)
  const instIds = [...new Set(
    (work.authorships || [])
      .flatMap(a => (a.institutions || []).map(i => i.id?.replace("https://openalex.org/", "")))
      .filter(Boolean)
  )];

  // ソース情報
  const source = work.primary_location?.source;

  return {
    openalex_id: work.id?.replace("https://openalex.org/", "") ?? null,
    doi: work.doi?.replace("https://doi.org/", "") ?? null,
    title: work.title ?? null,
    publication_year: work.publication_year ?? null,
    publication_date: work.publication_date ?? null,
    type: work.type ?? null,
    cited_by_count: work.cited_by_count ?? 0,
    is_oa: work.open_access?.is_oa ?? false,
    abstract_text: reconstructAbstract(work.abstract_inverted_index) ?? null,
    topics: JSON.stringify(topics),
    source_name: source?.display_name ?? null,
    source_type: source?.type ?? null,
    institution_ids: instIds.length > 0 ? instIds : [],
    company_slug: companySlug,
  };
}

// ---------------------------------------------------------------------------
// OpenAlex API
// ---------------------------------------------------------------------------
async function fetchOAPage(cursor, institutionId) {
  const filter = [
    `authorships.institutions.lineage:${institutionId}`,
    `publication_year:${CONFIG.yearFrom}-${CONFIG.yearTo}`,
  ].join(",");

  const params = new URLSearchParams({
    filter,
    per_page: CONFIG.oaPerPage,
    cursor: cursor,
    select: "id,doi,title,publication_year,publication_date,type,cited_by_count,open_access,abstract_inverted_index,topics,authorships,primary_location",
  });
  if (CONFIG.oaApiKey) params.set("api_key", CONFIG.oaApiKey);

  const url = `${CONFIG.oaBaseUrl}/works?${params}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`  [ERROR] OpenAlex ${res.status}: ${await res.text().catch(() => "")}`);
    return null;
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Supabase INSERT
// ---------------------------------------------------------------------------
async function insertBatch(works) {
  // works テーブルに UPSERT
  const worksPayload = works.map(w => ({
    openalex_id: w.openalex_id,
    doi: w.doi,
    title: w.title,
    publication_year: w.publication_year,
    publication_date: w.publication_date,
    type: w.type,
    cited_by_count: w.cited_by_count,
    is_oa: w.is_oa,
    abstract_text: w.abstract_text,
    topics: w.topics,
    source_name: w.source_name,
    source_type: w.source_type,
    institution_ids: `{${w.institution_ids.join(",")}}`,  // Postgres array literal
  }));

  const res1 = await fetch(
    `${CONFIG.sbUrl}/rest/v1/works`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": CONFIG.sbKey,
        "Authorization": `Bearer ${CONFIG.sbKey}`,
        "Prefer": "resolution=merge-duplicates",
        "Accept-Profile": "openalex",
        "Content-Profile": "openalex",
      },
      body: JSON.stringify(worksPayload),
    }
  );
  if (!res1.ok) {
    const err = await res1.text().catch(() => "");
    console.error(`  [ERROR] Supabase works: ${res1.status} ${err}`);
    return false;
  }

  // work_companies テーブルに UPSERT
  const wcPayload = works.map(w => ({
    openalex_id: w.openalex_id,
    company_slug: w.company_slug,
  }));

  const res2 = await fetch(
    `${CONFIG.sbUrl}/rest/v1/work_companies`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": CONFIG.sbKey,
        "Authorization": `Bearer ${CONFIG.sbKey}`,
        "Prefer": "resolution=merge-duplicates",
        "Accept-Profile": "openalex",
        "Content-Profile": "openalex",
      },
      body: JSON.stringify(wcPayload),
    }
  );
  if (!res2.ok) {
    const err = await res2.text().catch(() => "");
    console.error(`  [ERROR] Supabase work_companies: ${res2.status} ${err}`);
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// メイン
// ---------------------------------------------------------------------------
async function main() {
  console.log("=== OpenAlex Harvester ===");
  console.log(`企業: ${CONFIG.companySlug}`);
  console.log(`機関ID: ${CONFIG.institutionIds.join(", ")}`);
  console.log(`期間: ${CONFIG.yearFrom}-${CONFIG.yearTo}`);
  console.log(`API key: ${CONFIG.oaApiKey ? "あり" : "なし"}`);
  console.log(`Supabase: ${CONFIG.sbUrl ? "設定済み" : "未設定"}`);
  console.log();

  if (!CONFIG.sbKey) {
    console.error("SUPABASE_SERVICE_ROLE_KEY が設定されていません。");
    process.exit(1);
  }

  let totalFetched = 0;
  let totalInserted = 0;

  for (const instId of CONFIG.institutionIds) {
    console.log(`--- 機関: ${instId} ---`);
    let cursor = "*";
    let page = 0;

    while (cursor) {
      page++;
      const data = await fetchOAPage(cursor, instId);
      if (!data) {
        console.error("  取得失敗。中断します。");
        break;
      }

      const results = data.results || [];
      if (results.length === 0) break;

      if (page === 1) {
        console.log(`  総件数: ${data.meta?.count?.toLocaleString() || "不明"}`);
      }

      // 変換
      const works = results.map(w => transformWork(w, CONFIG.companySlug));
      totalFetched += works.length;

      // Supabase INSERT(バッチ分割)
      for (let i = 0; i < works.length; i += CONFIG.sbBatchSize) {
        const batch = works.slice(i, i + CONFIG.sbBatchSize);
        const ok = await insertBatch(batch);
        if (ok) totalInserted += batch.length;
      }

      process.stdout.write(`  ページ ${page}: ${results.length}件取得, 累計 ${totalFetched}件\r`);

      // 次ページ
      cursor = data.meta?.next_cursor || null;
      await sleep(CONFIG.oaDelayMs);
    }
    console.log();
  }

  console.log();
  console.log(`✅ 完了`);
  console.log(`  取得: ${totalFetched}件`);
  console.log(`  格納: ${totalInserted}件`);
  console.log();
  console.log(`確認SQL:`);
  console.log(`  select count(*) from openalex.works;`);
  console.log(`  select publication_year, count(*) from openalex.works group by 1 order by 1;`);
  console.log(`  select title, cited_by_count from openalex.works order by cited_by_count desc limit 10;`);
}

main().catch(e => { console.error(e); process.exit(1); });

#!/usr/bin/env node
// =============================================================================
// OpenAlex 論文ハーベスタ v3 (全社版・OA URL対応)
// =============================================================================
// v2からの変更: oa_url フィールド追加
//
// 使い方:
//   export OPENALEX_API_KEY=your_key
//   export SUPABASE_URL=https://oqttbviuzlpggetmvkgi.supabase.co
//   export SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
//   node openalex-harvester-all.mjs
//
// オプション:
//   SKIP_UNTIL=google    → 指定slugまでスキップ(中断再開用)
//   ONLY_SLUGS=apple,microsoft,meta  → 指定したslugだけ再取得(部分修正の再ハーベスト用)
//   YEAR_FROM=2022       → 開始年(デフォルト2022)
//   YEAR_TO=2026         → 終了年(デフォルト2026)
// =============================================================================

const YEAR_FROM = parseInt(process.env.YEAR_FROM || "2022");
const YEAR_TO   = parseInt(process.env.YEAR_TO   || "2026");
const SKIP_UNTIL = process.env.SKIP_UNTIL || "";
const ONLY_SLUGS = (process.env.ONLY_SLUGS || "").split(",").map(s => s.trim()).filter(Boolean);
const OA_BASE   = "https://api.openalex.org";
const OA_KEY    = process.env.OPENALEX_API_KEY || "";
const OA_DELAY  = 150;
const SB_URL    = process.env.SUPABASE_URL || "https://oqttbviuzlpggetmvkgi.supabase.co";
const SB_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const BATCH_SIZE = 50;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function reconstructAbstract(inv) {
  if (!inv) return null;
  const words = [];
  for (const [word, positions] of Object.entries(inv)) {
    for (const pos of positions) words[pos] = word;
  }
  return words.join(" ") || null;
}

function transformWork(work, companySlug) {
  const topics = (work.topics || []).slice(0, 5).map(t => ({
    id: t.id?.replace("https://openalex.org/", "") ?? null,
    display_name: t.display_name ?? null,
    score: t.score ?? null,
    subfield: t.subfield?.display_name ?? null,
    field: t.field?.display_name ?? null,
    domain: t.domain?.display_name ?? null,
  }));

  const instIds = [...new Set(
    (work.authorships || [])
      .flatMap(a => (a.institutions || []).map(i => i.id?.replace("https://openalex.org/", "")))
      .filter(Boolean)
  )];

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
    oa_url: work.open_access?.oa_url ?? null,
    abstract_text: reconstructAbstract(work.abstract_inverted_index) ?? null,
    topics: JSON.stringify(topics),
    source_name: source?.display_name ?? null,
    source_type: source?.type ?? null,
    institution_ids: instIds.length > 0 ? instIds : [],
    company_slug: companySlug,
  };
}

async function loadCrosswalk() {
  const res = await fetch(
    `${SB_URL}/rest/v1/company_crosswalk?select=canonical_slug,openalex_institution_ids&openalex_institution_ids=not.is.null&order=canonical_slug&limit=100`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Accept-Profile": "integration" } }
  );
  if (!res.ok) throw new Error(`crosswalk取得失敗: ${res.status} ${await res.text()}`);
  return res.json();
}

async function fetchOAPage(cursor, institutionId) {
  const filter = [
    `authorships.institutions.lineage:${institutionId}`,
    `publication_year:${YEAR_FROM}-${YEAR_TO}`,
  ].join(",");
  const params = new URLSearchParams({
    filter, per_page: "100", cursor,
    select: "id,doi,title,publication_year,publication_date,type,cited_by_count,open_access,abstract_inverted_index,topics,authorships,primary_location",
  });
  if (OA_KEY) params.set("api_key", OA_KEY);
  const res = await fetch(`${OA_BASE}/works?${params}`);
  if (!res.ok) { console.error(`    [WARN] OpenAlex ${res.status}`); return null; }
  return res.json();
}

async function insertBatch(works) {
  const worksPayload = works.map(w => ({
    openalex_id: w.openalex_id, doi: w.doi, title: w.title,
    publication_year: w.publication_year, publication_date: w.publication_date,
    type: w.type, cited_by_count: w.cited_by_count, is_oa: w.is_oa,
    oa_url: w.oa_url,
    abstract_text: w.abstract_text, topics: w.topics,
    source_name: w.source_name, source_type: w.source_type,
    institution_ids: `{${w.institution_ids.join(",")}}`,
  }));

  const headers = {
    "Content-Type": "application/json", apikey: SB_KEY,
    Authorization: `Bearer ${SB_KEY}`, "Prefer": "resolution=merge-duplicates",
    "Accept-Profile": "openalex", "Content-Profile": "openalex",
  };

  const res1 = await fetch(`${SB_URL}/rest/v1/works`, {
    method: "POST", headers, body: JSON.stringify(worksPayload),
  });

  if (!res1.ok) {
    let rescued = 0;
    for (const w of worksPayload) {
      const r = await fetch(`${SB_URL}/rest/v1/works`, {
        method: "POST", headers, body: JSON.stringify([w]),
      });
      if (r.ok) rescued++;
    }
    for (const w of works) {
      await fetch(`${SB_URL}/rest/v1/work_companies`, {
        method: "POST", headers,
        body: JSON.stringify([{ openalex_id: w.openalex_id, company_slug: w.company_slug }]),
      });
    }
    return rescued;
  }

  await fetch(`${SB_URL}/rest/v1/work_companies`, {
    method: "POST", headers,
    body: JSON.stringify(works.map(w => ({ openalex_id: w.openalex_id, company_slug: w.company_slug }))),
  });

  return works.length;
}

async function harvestCompany(slug, institutionIds) {
  let totalFetched = 0, totalInserted = 0;
  for (const instId of institutionIds) {
    let cursor = "*", page = 0, totalCount = "?";
    while (cursor) {
      page++;
      const data = await fetchOAPage(cursor, instId);
      if (!data) break;
      const results = data.results || [];
      if (results.length === 0) break;
      if (page === 1) totalCount = data.meta?.count || "?";
      const works = results.map(w => transformWork(w, slug));
      totalFetched += works.length;
      for (let i = 0; i < works.length; i += BATCH_SIZE) {
        const batch = works.slice(i, i + BATCH_SIZE);
        totalInserted += await insertBatch(batch);
      }
      process.stdout.write(`    ${instId}: ${totalFetched}/${totalCount}件\r`);
      cursor = data.meta?.next_cursor || null;
      await sleep(OA_DELAY);
    }
  }
  return { fetched: totalFetched, inserted: totalInserted };
}

async function main() {
  console.log("=== OpenAlex Harvester v3 (OA URL対応) ===");
  console.log(`期間: ${YEAR_FROM}-${YEAR_TO}`);
  console.log(`API key: ${OA_KEY ? "あり" : "なし"}`);
  if (SKIP_UNTIL) console.log(`スキップ: ${SKIP_UNTIL} まで`);
  if (ONLY_SLUGS.length) console.log(`対象を限定: ${ONLY_SLUGS.join(", ")}`);
  console.log();
  if (!SB_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY 未設定"); process.exit(1); }

  let companies = await loadCrosswalk();
  if (ONLY_SLUGS.length) {
    const onlySet = new Set(ONLY_SLUGS);
    companies = companies.filter(co => onlySet.has(co.canonical_slug));
    const found = new Set(companies.map(co => co.canonical_slug));
    for (const s of ONLY_SLUGS) if (!found.has(s)) console.warn(`  [WARN] ONLY_SLUGSに指定された "${s}" がcrosswalkに見つかりません`);
  }
  console.log(`対象: ${companies.length}社\n`);

  let grandFetched = 0, grandInserted = 0;
  let skipping = !!SKIP_UNTIL;
  const startTime = Date.now();

  for (let i = 0; i < companies.length; i++) {
    const co = companies[i];
    const slug = co.canonical_slug;
    const ids = co.openalex_institution_ids;
    if (skipping) { if (slug === SKIP_UNTIL) skipping = false; else { console.log(`  [SKIP] ${slug}`); continue; } }
    console.log(`[${i+1}/${companies.length}] ${slug} (IDs: ${ids.join(", ")})`);
    const result = await harvestCompany(slug, ids);
    grandFetched += result.fetched;
    grandInserted += result.inserted;
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log(`    → 取得: ${result.fetched}  格納: ${result.inserted}  (累計: ${grandFetched}件, ${elapsed}分経過)`);
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`✅ 全社完了`);
  console.log(`  取得合計: ${grandFetched}件`);
  console.log(`  格納合計: ${grandInserted}件`);
  console.log(`  所要時間: ${((Date.now() - startTime) / 1000 / 60).toFixed(1)}分`);
}

main().catch(e => { console.error(e); process.exit(1); });

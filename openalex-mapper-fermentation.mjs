#!/usr/bin/env node
// =============================================================================
// OpenAlex 機関マッパー(発酵・バイオ14社版)
// =============================================================================
// 使い方: node openalex-mapper-fermentation.mjs
// 出力: openalex_fermentation_candidates.json
// =============================================================================

const COMPANIES = [
  { slug: "AJINOMOTO",    query: "Ajinomoto" },
  { slug: "ASAHI GROUP",  query: "Asahi Group Holdings" },
  { slug: "KIKKOMAN",     query: "Kikkoman" },
  { slug: "kirin",        query: "Kirin Holdings" },
  { slug: "MEIJI CO LTD", query: "Meiji Holdings" },
  { slug: "suntory",      query: "Suntory" },
  { slug: "YAKULT",       query: "Yakult" },
  { slug: "novonesis",    query: "Novonesis" },
  { slug: "dsmfirmenich", query: "dsm-firmenich" },
  { slug: "danone",       query: "Danone" },
  { slug: "basf_ferm",    query: "BASF" },
  { slug: "corbion",      query: "Corbion" },
  { slug: "ginkgo",       query: "Ginkgo Bioworks" },
  { slug: "evonik",       query: "Evonik" },
];

const OA_BASE = "https://api.openalex.org";
const OA_KEY = process.env.OPENALEX_API_KEY || "";

async function searchInstitution(query) {
  const params = new URLSearchParams({ search: query, per_page: "10" });
  if (OA_KEY) params.set("api_key", OA_KEY);
  const res = await fetch(`${OA_BASE}/institutions?${params}`);
  if (!res.ok) { console.error(`  [ERROR] ${res.status} for "${query}"`); return []; }
  const data = await res.json();
  return (data.results || []).map(inst => ({
    openalex_id: inst.id?.replace("https://openalex.org/", ""),
    display_name: inst.display_name,
    country: inst.country_code,
    type: inst.type,
    works_count: inst.works_count,
    parent: inst.lineage && inst.lineage.length > 1 ? inst.lineage[inst.lineage.length - 2]?.replace("https://openalex.org/", "") : null,
  }));
}

async function main() {
  console.log("=== OpenAlex 機関マッパー(発酵・バイオ14社) ===\n");
  const allResults = [];

  for (const co of COMPANIES) {
    console.log(`検索中: ${co.slug} ("${co.query}")`);
    const candidates = await searchInstitution(co.query);
    const sorted = candidates.sort((a, b) => b.works_count - a.works_count);
    allResults.push({ slug: co.slug, query: co.query, candidates: sorted });

    if (sorted.length > 0) {
      console.log(`  候補 ${sorted.length}件 (トップ: ${sorted[0].display_name}, ${sorted[0].works_count}件, ${sorted[0].openalex_id})`);
    } else {
      console.log(`  候補なし`);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  const fs = await import("fs");
  fs.writeFileSync("openalex_fermentation_candidates.json", JSON.stringify(allResults, null, 2));
  console.log("\n✅ 完了: openalex_fermentation_candidates.json に保存しました");
}

main().catch(e => { console.error(e); process.exit(1); });

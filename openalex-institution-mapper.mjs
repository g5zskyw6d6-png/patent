#!/usr/bin/env node
// =============================================================================
// OpenAlex 機関マッピングツール (v2 — DB企業リスト準拠)
// =============================================================================
// 対象80社をOpenAlexで検索し、候補機関(ID,名前,論文数,国,親子関係)を収集。
// 結果を JSON + 読みやすいテキストで出力。
//
// 使い方:
//   OPENALEX_API_KEY=your_key node openalex-institution-mapper.mjs
//
// 出力:
//   openalex_institution_candidates.json  — 全候補(プログラム処理用)
//   openalex_institution_candidates.txt   — 人間が確認・選択する用
// =============================================================================

import { writeFileSync } from 'fs';

// ---------------------------------------------------------------------------
// 対象企業リスト (public.companies テーブル準拠 — 80社)
// slug: DB上のid, searchName: OpenAlex検索用英語名
// 日本語社名の企業は英語名で検索。中国企業も英語名。
// ---------------------------------------------------------------------------
const COMPANIES = [
  // ===== group_beauty (20社) =====
  { slug: "amorepacific", searchName: "Amorepacific",           group: "beauty" },
  { slug: "beiersdorf",   searchName: "Beiersdorf",             group: "beauty" },
  { slug: "colgate",      searchName: "Colgate-Palmolive",      group: "beauty" },
  { slug: "coty",         searchName: "Coty",                   group: "beauty" },
  { slug: "esteelauder",  searchName: "Estee Lauder",           group: "beauty" },
  { slug: "haleon",       searchName: "Haleon",                 group: "beauty" },
  { slug: "henkel",       searchName: "Henkel",                 group: "beauty" },
  { slug: "jnjconsumer",  searchName: "Johnson Johnson",        group: "beauty" },
  { slug: "kao",          searchName: "Kao Corporation",        group: "beauty" },
  { slug: "kose",         searchName: "Kose",                   group: "beauty" },
  { slug: "loreal",       searchName: "L'Oreal",                group: "beauty" },
  { slug: "lghh",         searchName: "LG Household",           group: "beauty" },
  { slug: "lion",         searchName: "Lion Corporation",       group: "beauty" },
  { slug: "lvmh",         searchName: "LVMH",                   group: "beauty" },
  { slug: "pg",           searchName: "Procter Gamble",         group: "beauty" },
  { slug: "polaorbis",    searchName: "Pola Orbis",             group: "beauty" },
  { slug: "reckitt",      searchName: "Reckitt Benckiser",      group: "beauty" },
  { slug: "rohto",        searchName: "Rohto Pharmaceutical",   group: "beauty" },
  { slug: "shiseido",     searchName: "Shiseido",               group: "beauty" },
  { slug: "unilever",     searchName: "Unilever",               group: "beauty" },
  // ===== group_china (20社) =====
  { slug: "alibaba",      searchName: "Alibaba",                group: "china" },
  { slug: "baidu",        searchName: "Baidu",                  group: "china" },
  { slug: "boe",          searchName: "BOE Technology",         group: "china" },
  { slug: "byd",          searchName: "BYD",                    group: "china" },
  { slug: "bytedance",    searchName: "ByteDance",              group: "china" },
  { slug: "cambricon",    searchName: "Cambricon",              group: "china" },
  { slug: "catl",         searchName: "CATL",                   group: "china" },
  { slug: "dji",          searchName: "DJI",                    group: "china" },
  { slug: "huawei",       searchName: "Huawei",                 group: "china" },
  { slug: "iflytek",      searchName: "iFlytek",                group: "china" },
  { slug: "jdcom",        searchName: "JD.com",                 group: "china" },
  { slug: "lenovo",       searchName: "Lenovo",                 group: "china" },
  { slug: "meituan",      searchName: "Meituan",                group: "china" },
  { slug: "nio",          searchName: "NIO",                    group: "china" },
  { slug: "pingan",       searchName: "Ping An",                group: "china" },
  { slug: "sensetime",    searchName: "SenseTime",              group: "china" },
  { slug: "smic",         searchName: "SMIC",                   group: "china" },
  { slug: "tencent",      searchName: "Tencent",                group: "china" },
  { slug: "xiaomi",       searchName: "Xiaomi",                 group: "china" },
  { slug: "zte",          searchName: "ZTE",                    group: "china" },
  // ===== group_japan (20社) =====
  { slug: "kddi",         searchName: "KDDI",                   group: "japan" },
  { slug: "nec",          searchName: "NEC Corporation",        group: "japan" },
  { slug: "ntt",          searchName: "NTT",                    group: "japan" },
  { slug: "pfn",          searchName: "Preferred Networks",     group: "japan" },
  { slug: "omron",        searchName: "Omron",                  group: "japan" },
  { slug: "keyence",      searchName: "Keyence",                group: "japan" },
  { slug: "canon",        searchName: "Canon",                  group: "japan" },
  { slug: "sony",         searchName: "Sony",                   group: "japan" },
  { slug: "softbank",     searchName: "SoftBank",               group: "japan" },
  { slug: "denso",        searchName: "Denso",                  group: "japan" },
  { slug: "toyota",       searchName: "Toyota",                 group: "japan" },
  { slug: "panasonic",    searchName: "Panasonic",              group: "japan" },
  { slug: "renesas",      searchName: "Renesas Electronics",    group: "japan" },
  { slug: "mitsubishie",  searchName: "Mitsubishi Electric",    group: "japan" },
  { slug: "nintendo",     searchName: "Nintendo",               group: "japan" },
  { slug: "fujifilm",     searchName: "Fujifilm",               group: "japan" },
  { slug: "fujitsu",      searchName: "Fujitsu",                group: "japan" },
  { slug: "hitachi",      searchName: "Hitachi",                group: "japan" },
  { slug: "murata",       searchName: "Murata Manufacturing",   group: "japan" },
  { slug: "rakuten",      searchName: "Rakuten",                group: "japan" },
  // ===== group_west (20社) =====
  { slug: "google",       searchName: "Google",                 group: "west" },
  { slug: "amazon",       searchName: "Amazon",                 group: "west" },
  { slug: "apple",        searchName: "Apple",                  group: "west" },
  { slug: "bosch",        searchName: "Bosch",                  group: "west" },
  { slug: "dassault",     searchName: "Dassault Systemes",      group: "west" },
  { slug: "ericsson",     searchName: "Ericsson",               group: "west" },
  { slug: "ibm",          searchName: "IBM",                    group: "west" },
  { slug: "intel",        searchName: "Intel",                  group: "west" },
  { slug: "meta",         searchName: "Meta",                   group: "west" },
  { slug: "microsoft",    searchName: "Microsoft",              group: "west" },
  { slug: "nokia",        searchName: "Nokia",                  group: "west" },
  { slug: "nvidia",       searchName: "NVIDIA",                 group: "west" },
  { slug: "oracle",       searchName: "Oracle",                 group: "west" },
  { slug: "philips",      searchName: "Philips",                group: "west" },
  { slug: "qualcomm",     searchName: "Qualcomm",               group: "west" },
  { slug: "samsung",      searchName: "Samsung",                group: "west" },
  { slug: "sap",          searchName: "SAP",                    group: "west" },
  { slug: "siemens",      searchName: "Siemens",                group: "west" },
  { slug: "tesla",        searchName: "Tesla",                  group: "west" },
  { slug: "tsmc",         searchName: "TSMC",                   group: "west" },
];

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
const BASE = "https://api.openalex.org";
const API_KEY = process.env.OPENALEX_API_KEY || "";
const DELAY_MS = 200;

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchOA(path) {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${BASE}${path}${API_KEY ? sep + "api_key=" + API_KEY : ""}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`  [WARN] ${res.status} for ${path}`);
    return null;
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// 1社ぶんの候補収集
// ---------------------------------------------------------------------------
async function searchInstitutions(company) {
  const query = encodeURIComponent(company.searchName);
  const data = await fetchOA(`/institutions?search=${query}&per_page=10`);
  if (!data || !data.results) return [];

  return data.results
    .filter(r => {
      // 論文が1件以上あるか、名前が検索語を含む候補を残す
      const nameLower = r.display_name.toLowerCase();
      const searchLower = company.searchName.toLowerCase();
      return r.works_count > 0 || nameLower.includes(searchLower);
    })
    .map(r => ({
      openalex_id: r.id.replace("https://openalex.org/", ""),
      display_name: r.display_name,
      works_count: r.works_count,
      cited_by_count: r.cited_by_count,
      country_code: r.country_code,
      type: r.type,
      ror: r.ror || null,
      homepage: r.homepage_url || null,
      parent: (r.associated_institutions || [])
        .filter(a => a.relationship === "parent")
        .map(a => `${a.display_name} (${a.id.replace("https://openalex.org/","")})`)
        .join("; ") || null,
      children_count: (r.associated_institutions || [])
        .filter(a => a.relationship === "child").length,
      children: (r.associated_institutions || [])
        .filter(a => a.relationship === "child")
        .map(a => ({
          id: a.id.replace("https://openalex.org/",""),
          name: a.display_name,
          country: a.country_code
        })),
      // 直近3年の論文数(トレンド確認用)
      recent_years: (r.counts_by_year || [])
        .filter(y => y.year >= 2022 && y.year <= 2024)
        .sort((a,b) => a.year - b.year)
        .map(y => `${y.year}:${y.works_count}`)
        .join("  ")
    }));
}

// ---------------------------------------------------------------------------
// メイン
// ---------------------------------------------------------------------------
async function main() {
  console.log(`=== OpenAlex Institution Mapper v2 ===`);
  console.log(`対象企業: ${COMPANIES.length}社`);
  console.log(`API key: ${API_KEY ? "設定済み" : "なし(レート制限に注意)"}\n`);

  const allResults = [];
  const textLines = [
    `OpenAlex 機関候補一覧 (生成日: ${new Date().toISOString().slice(0,10)})`,
    `対象: ${COMPANIES.length}社`,
    ``
  ];

  for (let i = 0; i < COMPANIES.length; i++) {
    const co = COMPANIES[i];
    process.stdout.write(`[${String(i+1).padStart(2)}/${COMPANIES.length}] ${co.slug.padEnd(16)} "${co.searchName}"...`);

    const candidates = await searchInstitutions(co);
    allResults.push({ ...co, candidates });

    // テキスト出力
    textLines.push(`${"━".repeat(70)}`);
    textLines.push(`${co.slug}  |  検索: "${co.searchName}"  |  グループ: ${co.group}`);
    textLines.push(`${"━".repeat(70)}`);

    if (candidates.length === 0) {
      textLines.push(`  ⚠ 候補なし — 検索名を変えて再試行してください`);
    } else {
      // 推奨(works_count最大かつtype=company)をマーク
      const best = candidates
        .filter(c => c.type === "company")
        .sort((a,b) => b.works_count - a.works_count)[0];

      for (const c of candidates) {
        const isBest = best && c.openalex_id === best.openalex_id;
        const mark = isBest ? " ★推奨" : "";
        textLines.push(`  ${c.openalex_id}  ${c.display_name}${mark}`);
        textLines.push(`    論文: ${c.works_count.toLocaleString()}  被引用: ${c.cited_by_count.toLocaleString()}  国: ${c.country_code}  種別: ${c.type}`);
        if (c.recent_years) textLines.push(`    直近: ${c.recent_years}`);
        if (c.ror) textLines.push(`    ROR: ${c.ror}`);
        if (c.parent) textLines.push(`    親: ${c.parent}`);
        if (c.children_count > 0) {
          textLines.push(`    子機関: ${c.children_count}件`);
          for (const ch of c.children.slice(0, 8)) {
            textLines.push(`      - ${ch.name} (${ch.id}) [${ch.country}]`);
          }
          if (c.children_count > 8) textLines.push(`      ... 他${c.children_count - 8}件`);
        }
      }
    }
    textLines.push(``);

    console.log(` → ${candidates.length}件${candidates.length === 0 ? " ⚠" : ""}`);
    await sleep(DELAY_MS);
  }

  // サマリ
  const noHit = allResults.filter(r => r.candidates.length === 0);
  const multiHit = allResults.filter(r => r.candidates.filter(c => c.type === "company").length > 1);

  textLines.push(`${"━".repeat(70)}`);
  textLines.push(`=== サマリ ===`);
  textLines.push(`全${COMPANIES.length}社`);
  textLines.push(`  候補なし: ${noHit.length}社${noHit.length > 0 ? "  → " + noHit.map(r=>r.slug).join(", ") : ""}`);
  textLines.push(`  company型が複数: ${multiHit.length}社(名寄せ要確認)`);
  textLines.push(`${"━".repeat(70)}`);

  // ファイル出力
  writeFileSync("openalex_institution_candidates.json",
    JSON.stringify(allResults, null, 2), "utf-8");
  writeFileSync("openalex_institution_candidates.txt",
    textLines.join("\n"), "utf-8");

  console.log(`\n✅ 出力完了:`);
  console.log(`  openalex_institution_candidates.json`);
  console.log(`  openalex_institution_candidates.txt`);
  console.log(`\n次のステップ: .txt を開いて各社の★推奨を確認し、`);
  console.log(`  束ねるID(本体+子機関)を決めてください。`);
}

main().catch(e => { console.error(e); process.exit(1); });

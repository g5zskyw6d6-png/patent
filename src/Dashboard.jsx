import { useState, useEffect, useCallback, useRef } from "react";
import TechPortfolio from "./TechPortfolio";
import PaperExplorer from "./PaperExplorer";
import BurstDetector from "./BurstDetector";

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Dashboard.jsx — 分析・解説・比較・概要の全機能ハブ
   DBから特許データを読み込み、各種AI分析を実行します
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const COUNTRY_COLORS = { US:"#38bdf8", WO:"#34d399", JP:"#f59e0b" };
const CAT_COLORS = ["#38bdf8","#34d399","#818cf8","#f59e0b","#fb7185","#e879f9","#2dd4bf","#f97316"];


/* ━━━ OpenAlex キーワードフィルター構築（PaperExplorer.jsx から移植） ━━━━ */
function buildKeywordFilter(raw) {
  if (!raw.trim()) return "";
  const parts = raw.trim().split(/\s+/);
  const andT = [], orT = [], notT = [];
  let mode = "and";
  for (const p of parts) {
    if (p.toUpperCase() === "AND") { mode = "and"; continue; }
    if (p.toUpperCase() === "OR") { mode = "or"; continue; }
    if (p.toUpperCase() === "NOT") { mode = "not"; continue; }
    if (mode === "or") orT.push(p);
    else if (mode === "not") notT.push(p);
    else andT.push(p);
    mode = "and";
  }
  const f = [];
  for (const t of andT) f.push(`or=(title.ilike.*${t}*,abstract_text.ilike.*${t}*)`);
  if (orT.length > 0) f.push(`or=(${orT.map(t => `title.ilike.*${t}*,abstract_text.ilike.*${t}*`).join(",")})`);
  for (const t of notT) { f.push(`title=not.ilike.*${t}*`); f.push(`abstract_text=not.ilike.*${t}*`); }
  return f.join("&");
}

/* ━━━ PDF出力ユーティリティ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function printToPDF(title, htmlContent) {
  const win = window.open("", "_blank");
  win.document.write(`<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8"/>
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif; font-size: 11pt; color: #111; background: #fff; padding: 20mm 15mm; }
    h1 { font-size: 16pt; color: #0a2540; border-bottom: 2px solid #0a2540; padding-bottom: 6px; margin-bottom: 12px; }
    h2 { font-size: 13pt; color: #1a4a7a; margin: 16px 0 8px; border-left: 4px solid #1a4a7a; padding-left: 8px; }
    h3 { font-size: 11pt; color: #333; margin: 12px 0 5px; }
    p, .body-text { font-size: 10.5pt; line-height: 1.75; color: #222; margin-bottom: 6px; }
    .meta { font-size: 9.5pt; color: #555; margin-bottom: 16px; }
    .section { margin-bottom: 18px; padding: 12px 14px; border: 1px solid #dde; border-radius: 6px; page-break-inside: avoid; }
    .section-title { font-size: 10pt; font-weight: bold; color: #1a4a7a; margin-bottom: 6px; text-transform: uppercase; letter-spacing: .04em; }
    .cat-row { display: flex; align-items: center; gap: 12px; margin-bottom: 7px; }
    .cat-name { font-size: 10.5pt; font-weight: 600; min-width: 160px; }
    .cat-bar-wrap { flex: 1; height: 8px; background: #eef; border-radius: 4px; overflow: hidden; }
    .cat-bar { height: 100%; background: #2563eb; border-radius: 4px; }
    .cat-pct { font-size: 10pt; font-weight: 700; color: #2563eb; min-width: 40px; text-align: right; }
    .cat-desc { font-size: 9.5pt; color: #555; margin-left: 4px; }
    .trend { padding: 8px 10px 8px 14px; border-left: 3px solid #f59e0b; margin-bottom: 8px; background: #fffbf0; border-radius: 0 4px 4px 0; }
    .trend-title { font-size: 10.5pt; font-weight: 600; margin-bottom: 3px; }
    .trend-body { font-size: 10pt; color: #333; line-height: 1.7; }
    .score-row { display: flex; gap: 20px; margin-bottom: 10px; }
    .score-item { text-align: center; }
    .score-num { font-size: 22pt; font-weight: 700; color: #2563eb; line-height: 1; }
    .score-label { font-size: 8.5pt; color: #555; }
    .highlight { background: #f0f7ff; border: 1px solid #bcd; padding: 10px 14px; border-radius: 5px; margin-bottom: 10px; }
    .footer { margin-top: 24px; padding-top: 10px; border-top: 1px solid #ccc; font-size: 8.5pt; color: #888; }
    @media print {
      body { padding: 0; }
      .section { page-break-inside: avoid; }
      @page { margin: 15mm 12mm; size: A4; }
    }
  </style>
</head>
<body>
${htmlContent}
<div class="footer">出力日時: ${new Date().toLocaleString("ja-JP")} — Patent Intelligence Platform</div>
</body>
</html>`);
  win.document.close();
  setTimeout(() => { win.print(); }, 400);
}

function generatePortfolioHTML(company, analysis, dbMeta) {
  const cats = (analysis.categories || []).map(cat => `
    <div class="cat-row">
      <span class="cat-name">${cat.name}</span>
      <div class="cat-bar-wrap"><div class="cat-bar" style="width:${cat.pct}%"></div></div>
      <span class="cat-pct">${cat.pct}%</span>
    </div>
    <div class="cat-desc">${cat.desc || ""}</div>
  `).join("");

  const trends = (analysis.trends || []).map((t, i) => `
    <div class="trend">
      <div class="trend-title">動向${i+1}: ${t.title}</div>
      <div class="trend-body">${t.body}</div>
    </div>
  `).join("");

  return `
    <h1>📊 AI特許ポートフォリオ分析レポート</h1>
    <div class="meta">
      <strong>${company?.name || ""}</strong>
      ${dbMeta ? ` ／ 対象特許: ${dbMeta.total_patents}件 ／ 分析日時: ${new Date(dbMeta.analyzed_at).toLocaleString("ja-JP")}` : ""}
    </div>
    <h2>技術カテゴリー分類</h2>
    <div class="section">${cats}</div>
    <h2>主要イノベーション動向</h2>
    <div class="section">${trends}</div>
    <h2>2050年 社会変革シナリオ</h2>
    <div class="section"><p class="body-text">${analysis.impact2050 || ""}</p></div>
    <h2>戦略的示唆</h2>
    <div class="section"><p class="body-text">${analysis.strategic || ""}</p></div>
    ${analysis.topPatent ? `<h2>★ 最注目特許</h2><div class="section highlight"><p class="body-text">${analysis.topPatent}</p></div>` : ""}
  `;
}

function generateDetailHTML(patent, analysis) {
  const scores = `
    <div class="score-row">
      <div class="score-item"><div class="score-num" style="color:#2563eb">${analysis.scoreNovelty}</div><div class="score-label">革新性 /10</div></div>
      <div class="score-item"><div class="score-num" style="color:#16a34a">${analysis.scoreImpact}</div><div class="score-label">社会的インパクト /10</div></div>
      <div class="score-item"><div class="score-num" style="color:#d97706">${analysis.scoreCommercial}</div><div class="score-label">商業的価値 /10</div></div>
    </div>
  `;
  const sections = [
    { label:"技術的課題",       value: analysis.problem,      color:"#2563eb" },
    { label:"技術の仕組み",     value: analysis.mechanism,    color:"#d97706" },
    { label:"革新性・新規性",   value: analysis.novelty,      color:"#16a34a" },
    { label:"請求項の保護範囲", value: analysis.protection,   color:"#7c3aed" },
    { label:"応用分野",         value: analysis.applications, color:"#0891b2" },
    { label:"企業戦略上の意義", value: analysis.strategy,     color:"#ea580c" },
    { label:"2050年へのインパクト", value: analysis.future2050, color:"#9333ea" },
  ].filter(s => s.value).map(s => `
    <div class="section">
      <div class="section-title" style="color:${s.color}">【${s.label}】</div>
      <p class="body-text">${s.value}</p>
    </div>
  `).join("");

  return `
    <h1>🔬 個別特許 詳細分析レポート</h1>
    <div class="meta">
      <strong>${patent.title_en || patent.patent_number}</strong><br/>
      ${analysis.titleJa ? `<strong style="color:#1a4a7a">${analysis.titleJa}</strong><br/>` : ""}
      特許番号: ${patent.patent_number} ／ 国: ${patent.country} ／ 公開日: ${patent.publication_date}<br/>
      ${patent.company_name ? `出願人: ${patent.company_name}` : ""}
    </div>
    <h2>評価スコア</h2>
    <div class="section">${scores}</div>
    ${sections}
  `;
}

export default function Dashboard({ supabaseUrl, supabaseKey, claudeApiKey, epoConsumerKey, epoConsumerSecret, companies, onClose }) {

  const [tab, setTab] = useState("search");
  const c = {
    bg0:"#030b14", bg1:"#071828", bg2:"#0d2137", bg3:"#0c2d42",
    border:"#1a3550", text:"#cce3f5", muted:"#5c87ac",
    cyan:"#38bdf8", amber:"#f59e0b", green:"#34d399", purple:"#818cf8",
  };
  const card = { background:c.bg1, border:"1px solid "+c.border, borderRadius:10, padding:"14px 16px" };

  /* ━━━ Supabase REST ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  const sbH = useCallback(() => ({
    "apikey": supabaseKey,
    "Authorization": "Bearer " + supabaseKey,
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates,return=minimal",
  }), [supabaseKey]);

  const sbGet = useCallback(async (path) => {
    const res = await fetch(supabaseUrl + "/rest/v1/" + path, {
      headers: {
        "apikey": supabaseKey,
        "Authorization": "Bearer " + supabaseKey,
        "Accept": "application/json",
      },
    });
    if (!res.ok) throw new Error("Supabase GET failed: " + res.status);
    return res.json();
  }, [supabaseUrl, supabaseKey]);

  // シンプルINSERT（conflicts不要な場合）
  const sbPost = useCallback(async (path, body) => {
    const headers = {
      "apikey": supabaseKey, "Authorization": "Bearer " + supabaseKey,
      "Content-Type": "application/json", "Prefer": "return=minimal",
    };
    const res = await fetch(supabaseUrl + "/rest/v1/" + path, {
      method: "POST", headers, body: JSON.stringify(body),
    });
    if (!res.ok) console.warn("Supabase POST failed (" + path + "):", res.status);
  }, [supabaseUrl, supabaseKey]);

  // DELETE + INSERT によるupsert（409を回避する確実な方法）


  // DELETE + INSERT upsert（複数カラムのキー指定に対応）
  const sbUpsert = useCallback(async (path, rows, conflictColumns) => {
    if (!rows || rows.length === 0) return;
    const authHeaders = {
      "apikey": supabaseKey,
      "Authorization": "Bearer " + supabaseKey,
    };
    const jsonHeaders = {
      ...authHeaders,
      "Content-Type": "application/json",
      "Prefer": "return=minimal",
    };
    const cols = Array.isArray(conflictColumns) ? conflictColumns : [conflictColumns];

    // ① 既存レコードを削除（単一カラムの場合は in.() で一括、複数カラムは先頭キーで絞り込み）
    const firstCol = cols[0];
    const ids = [...new Set(rows.map(r => r[firstCol]).filter(v => v != null))];
    if (ids.length > 0) {
      // Safari CORS対策: DELETEはauthHeadersのみ（Content-Typeなし）
      const delUrl = supabaseUrl + "/rest/v1/" + path
        + "?" + firstCol + "=in.(" + ids.map(id => encodeURIComponent(id)).join(",") + ")";
      const delRes = await fetch(delUrl, { method: "DELETE", headers: authHeaders });
      if (!delRes.ok) {
        const txt = await delRes.text().catch(() => "");
        console.warn("DEL failed:", delRes.status, txt);
      }
    }

    // ② 新しいレコードを挿入
    const insRes = await fetch(supabaseUrl + "/rest/v1/" + path, {
      method: "POST", headers: jsonHeaders, body: JSON.stringify(rows),
    });
    if (!insRes.ok) {
      const errBody = await insRes.text().catch(() => "");
      const errMsg = "DB保存失敗 (" + path + " HTTP" + insRes.status + "): " + errBody.slice(0,200);
      console.error(errMsg);
      throw new Error(errMsg);
    }
  }, [supabaseUrl, supabaseKey]);

  const sbRpc = useCallback(async (fn, params) => {
    const res = await fetch(supabaseUrl + "/rest/v1/rpc/" + fn, {
      method: "POST",
      headers: {
        "apikey": supabaseKey,
        "Authorization": "Bearer " + supabaseKey,
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Accept-Profile": "public",
      },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error("RPC failed (" + fn + ") " + res.status + ": " + errText.slice(0,200));
    }
    return res.json();
  }, [supabaseUrl, supabaseKey]);

  // portfolio_analyses専用保存（RPC経由でSafari CORS問題を回避）
  const sbSaveAnalysis = useCallback(async (row) => {
    const authHeaders = {
      "apikey": supabaseKey,
      "Authorization": "Bearer " + supabaseKey,
    };
    const jsonHeaders = {
      ...authHeaders,
      "Content-Type": "application/json",
      "Prefer": "return=minimal",
    };

    // まずRPCを試みる
    try {
      await sbRpc("upsert_portfolio_analysis", row);
      return;
    } catch(e) {
      console.warn("RPC upsert failed, falling back to DELETE+INSERT:", e.message);
    }

    // フォールバック: DELETE + INSERT（Safari CORS対応・409回避）
    const delUrl = supabaseUrl + "/rest/v1/portfolio_analyses"
      + "?company_id=eq." + encodeURIComponent(row.company_id)
      + "&date_from=eq."  + encodeURIComponent(row.date_from)
      + "&date_to=eq."    + encodeURIComponent(row.date_to);
    const delRes = await fetch(delUrl, { method: "DELETE", headers: authHeaders });
    if (!delRes.ok) {
      const txt = await delRes.text().catch(() => "");
      console.warn("DEL portfolio_analyses failed:", delRes.status, txt);
    }

    const insRes = await fetch(supabaseUrl + "/rest/v1/portfolio_analyses", {
      method: "POST", headers: jsonHeaders, body: JSON.stringify([row]),
    });
    if (!insRes.ok) {
      const errBody = await insRes.text().catch(() => "");
      throw new Error("分析DB保存失敗 HTTP" + insRes.status + ": " + errBody.slice(0, 200));
    }
  }, [supabaseUrl, supabaseKey, sbRpc]);

  /* ━━━ Claude AI ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  const claudePost = useCallback(async (prompt, maxTokens = 1000, retries = 3) => {
    let lastError = null;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId  = setTimeout(() => controller.abort(), 200000); // 200秒タイムアウト
        let res;
        try {
          res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            signal: controller.signal,
            headers: {
              "Content-Type": "application/json",
              "x-api-key": claudeApiKey,
              "anthropic-version": "2023-06-01",
              "anthropic-dangerous-direct-browser-access": "true",
            },
            body: JSON.stringify({
              model: "claude-sonnet-4-6",
              max_tokens: maxTokens,
              messages: [{ role: "user", content: prompt }],
            }),
          });
        } finally {
          clearTimeout(timeoutId);
        }
        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          lastError = new Error("HTTP " + res.status + ": " + errText.slice(0, 200));
          if ((res.status === 529 || res.status === 503 || res.status === 500) && attempt < retries) {
            await new Promise(r => setTimeout(r, 2000 * attempt)); continue;
          }
          throw lastError;
        }
        const data = await res.json();
        if (!data.content?.[0]?.text) throw new Error("Claude API empty response");
        return data.content[0].text;
      } catch(e) {
        lastError = e;
        const isRetryable = e.name === "AbortError"
          || e.message === "Load failed"
          || e.message === "Failed to fetch"
          || e.message.includes("NetworkError")
          || e.message.includes("network");
        console.warn("claudePost attempt "+attempt+" failed:", e.message);
        if (isRetryable && attempt < retries) {
          await new Promise(r => setTimeout(r, 3000 * attempt)); continue;
        }
        throw e;
      }
    }
    throw lastError || new Error("claudePost: all retries exhausted");
  }, [claudeApiKey]);

  /* ━━━ EPO OPS（請求項・説明文取得） ━━━━━━━━━━━━━━━━━━━━━━━━ */
  const getEPOToken = useCallback(async () => {
    const res = await fetch("/api/epo/auth/accesstoken", {
      method:"POST",
      headers: { "Authorization":"Basic "+btoa(epoConsumerKey+":"+epoConsumerSecret), "Content-Type":"application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new Error("EPO認証失敗: " + res.status);
    return (await res.json()).access_token;
  }, [epoConsumerKey, epoConsumerSecret]);

  const buildEpodocCandidates = (patent) => {
    const { country, docNum, kind } = patent;
    if (!docNum) return [];
    const c = [];
    if (kind) c.push(country+"."+docNum+"."+kind);
    c.push(country+"."+docNum);
    if (kind==="A1"||kind==="A2") { c.push(country+"."+docNum+".B1"); c.push(country+"."+docNum+".B2"); }
    if (kind==="B2") c.push(country+"."+docNum+".B1");
    if (kind==="B1") c.push(country+"."+docNum+".B2");
    return [...new Set(c)];
  };
  const buildDocdbCandidates = (patent) => {
    const { country, docNum, kind } = patent;
    if (!docNum) return [];
    const c = [];
    if (kind) c.push(country+"."+docNum+"."+kind);
    c.push(country+"."+docNum);
    if (kind==="B2") c.push(country+"."+docNum+".B1");
    if (kind==="B1") c.push(country+"."+docNum+".B2");
    return [...new Set(c)];
  };

  const fetchDescription = useCallback(async (patent) => {
    const token = await getEPOToken();
    const headers = { "Authorization":"Bearer "+token, "Accept":"application/xml" };
    const parse = async (res) => {
      if (!res.ok) return null;
      const doc = new DOMParser().parseFromString(await res.text(), "application/xml");
      const paras = [];
      doc.querySelectorAll("description p, description-of-embodiments p, p").forEach(p => {
        const t = p.textContent.trim(); if (t.length > 20) paras.push(t);
      });
      return paras.length > 0 ? paras.join("\n\n") : null;
    };
    for (const id of buildEpodocCandidates(patent)) {
      try { const t = await parse(await fetch("/api/epo/published-data/publication/epodoc/"+encodeURIComponent(id)+"/description",{headers})); if (t) return { text:t, id, format:"epodoc" }; } catch(e) {}
    }
    for (const id of buildDocdbCandidates(patent)) {
      try { const t = await parse(await fetch("/api/epo/published-data/publication/docdb/"+encodeURIComponent(id)+"/description",{headers})); if (t) return { text:t, id, format:"docdb" }; } catch(e) {}
    }
    throw new Error("説明文取得失敗");
  }, [getEPOToken]);

  const fetchClaims = useCallback(async (patent) => {
    const token = await getEPOToken();
    const headers = { "Authorization":"Bearer "+token, "Accept":"application/xml" };
    const parse = async (res) => {
      if (!res.ok) return null;
      const doc = new DOMParser().parseFromString(await res.text(), "application/xml");
      const all = [], indep = [];
      let el = null;
      doc.querySelectorAll("claims").forEach(c => { if (!el||c.getAttribute("lang")==="EN"||c.getAttribute("lang")==="en") el=c; });
      if (!el) return null;
      el.querySelectorAll("claim").forEach(claim => {
        const num = claim.getAttribute("num")||"";
        const text = Array.from(claim.querySelectorAll("claim-text")).map(ct=>ct.textContent.trim()).join(" ").trim();
        if (text) { all.push("請求項"+num+": "+text); if (!claim.querySelector("claim-ref")) indep.push("請求項"+num+": "+text); }
      });
      return all.length > 0 ? { allClaims:all.join("\n\n"), independentClaims:indep.join("\n\n") } : null;
    };
    for (const id of buildEpodocCandidates(patent)) {
      try { const r = await parse(await fetch("/api/epo/published-data/publication/epodoc/"+encodeURIComponent(id)+"/claims",{headers})); if (r) return { ...r, id, format:"epodoc" }; } catch(e) {}
    }
    for (const id of buildDocdbCandidates(patent)) {
      try { const r = await parse(await fetch("/api/epo/published-data/publication/docdb/"+encodeURIComponent(id)+"/claims",{headers})); if (r) return { ...r, id, format:"docdb" }; } catch(e) {}
    }
    throw new Error("請求項取得失敗");
  }, [getEPOToken]);

// ★ 企業別特許統計
  const [patentStats, setPatentStats] = useState({});

useEffect(() => {
    if (!supabaseUrl || !supabaseKey) return;
    const fetchStats = async (attempt = 1) => {
      try {
        const res = await fetch(supabaseUrl+"/rest/v1/company_patent_stats?select=*", {
          headers:{"apikey":supabaseKey,"Authorization":"Bearer "+supabaseKey,"Accept":"application/json"}
        });
        if (!res.ok) throw new Error("HTTP "+res.status);
        const rows = await res.json();
        const map = {};
        rows.forEach(s => { map[s.company_id] = s; });
        setPatentStats(map);
      } catch(e) {
        if (attempt < 3) {
          setTimeout(() => fetchStats(attempt + 1), 1500 * attempt);
        }
      }
    };
    fetchStats();
  }, [supabaseUrl, supabaseKey]);

  const companiesWithStats = companies.map(co => ({
    ...co, _stats: patentStats[co.id] || null
  }));


  const TABS = [
    { id:"search",   label:"🔍 検索・閲覧" },
    { id:"analyze",  label:"🤖 AI分析" },
    { id:"manage",   label:"⚙️ 企業管理" },
    { id:"keywords",  label:"🏷️ キーワード" },
    { id:"burst",    label:"🔥 バースト検知" },
    { id:"tech",     label:"🧭 技術ポートフォリオ" },
  ];

  return (
    <div style={{position:"fixed",inset:0,background:c.bg0,color:c.text,fontFamily:"system-ui,-apple-system,sans-serif",display:"flex",flexDirection:"column",zIndex:200,overflow:"hidden"}}>

      {/* ヘッダー */}
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"0 18px",height:50,borderBottom:"1px solid "+c.border,background:c.bg1,flexShrink:0}}>
        <div style={{width:8,height:8,borderRadius:"50%",background:c.purple}}/>
        <span style={{fontWeight:700,fontSize:14,color:c.purple}}>PATENT DASHBOARD</span><span style={{fontSize:10,color:"#666",marginLeft:4}}>v2.1</span>
        <span style={{fontSize:12,color:c.muted}}>/ 分析・解説・比較・概要</span>
        <div style={{display:"flex",gap:4,marginLeft:12}}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{padding:"4px 12px",borderRadius:6,border:"1px solid "+(tab===t.id?c.purple:c.border),background:tab===t.id?"#0d0820":"transparent",color:tab===t.id?c.purple:c.muted,fontSize:11,cursor:"pointer",fontWeight:tab===t.id?700:400,whiteSpace:"nowrap"}}>
              {t.label}
            </button>
          ))}
        </div>
        <button onClick={onClose} style={{marginLeft:"auto",padding:"5px 14px",borderRadius:6,border:"1px solid "+c.border,background:"transparent",color:c.muted,fontSize:12,cursor:"pointer"}}>
          ← 特許取得画面に戻る
        </button>
      </div>

      {/* タブコンテンツ */}
      {tab === "search"    && <SearchOrPaper sbRpc={sbRpc} fetchDescription={fetchDescription} fetchClaims={fetchClaims} claudePost={claudePost} sbPost={sbPost} sbUpsert={sbUpsert} sbSaveAnalysis={sbSaveAnalysis} supabaseUrl={supabaseUrl} supabaseKey={supabaseKey} claudeApiKey={claudeApiKey} companies={companiesWithStats} c={c} card={card}/>}
      {tab === "analyze"   && <AnalyzeTab   sbGet={sbGet} supabaseUrl={supabaseUrl} supabaseKey={supabaseKey} companies={companies} c={c} card={card}/>}

      {tab === "manage"    && <ManageTab    supabaseUrl={supabaseUrl} supabaseKey={supabaseKey} companies={companies} onRefresh={onClose} c={c} card={card}/>}
      {tab === "keywords"  && <KeywordsTab  sbGet={sbGet} claudePost={claudePost} companies={companies} supabaseUrl={supabaseUrl} supabaseKey={supabaseKey} c={c} card={card}/>}
      {tab === "burst"     && <BurstDetector supabaseUrl={supabaseUrl} supabaseKey={supabaseKey} companies={companies} c={c} card={card}/>}
      {tab === "tech"      && <TechPortfolio supabaseUrl={supabaseUrl} supabaseKey={supabaseKey} sbRpc={sbRpc}/>}
      <style>{`input[type=date]::-webkit-calendar-picker-indicator{filter:invert(0.6);}::-webkit-scrollbar{width:6px;}::-webkit-scrollbar-track{background:transparent;}::-webkit-scrollbar-thumb{background:#1a3550;border-radius:3px;}`}</style>
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   🔍 検索・閲覧タブ（個別詳細分析・CSV保存 含む）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function SearchTab({ sbRpc, fetchDescription, fetchClaims, claudePost, sbPost, sbUpsert, sbSaveAnalysis, supabaseUrl, supabaseKey, companies, c, card }) {
  const [keyword,      setKeyword]      = useState("");
  const [inventor,     setInventor]     = useState("");
  const [selCompanies, setSelCompanies] = useState([]);
  const [selCountries, setSelCountries] = useState([]);
  const [dateFrom,     setDateFrom]     = useState("2024-01-01");
  const [dateTo,       setDateTo]       = useState("2026-03-31");
  const [results,      setResults]      = useState([]);
  const [totalCount,   setTotalCount]   = useState(0);
  const [page,         setPage]         = useState(0);
  const [loading,       setLoading]       = useState(false);
  const [err,           setErr]           = useState("");
  const [detailPatent,  setDetailPatent]  = useState(null);
  const [analyzePhase,  setAnalyzePhase]  = useState("idle"); // idle | analyzing | done
  const [analysis,      setAnalysis]      = useState(null);
  const [showAnalysis,  setShowAnalysis]  = useState(true);

  const PAGE_SIZE = 20;

  const doSearch = useCallback(async (pg = 0) => {
    setLoading(true); setErr("");
    try {
      const data = await sbRpc("search_patents", {
        keyword:     keyword.trim() || null,
        inventor:    inventor.trim() || null,
        company_ids: selCompanies.length > 0 ? selCompanies : null,
        countries:   selCountries.length > 0 ? selCountries : null,
        from_date:   dateFrom || null,
        to_date:     dateTo   || null,
        page_offset: pg * PAGE_SIZE,
        page_limit:  PAGE_SIZE,
      });
      setResults(data || []);
      setTotalCount(data?.[0]?.total_count ? Number(data[0].total_count) : 0);
      setPage(pg);
    } catch(e) { setErr("検索エラー: " + e.message); }
    setLoading(false);
  }, [sbRpc, keyword, selCompanies, selCountries, dateFrom, dateTo]);

  const downloadCSV = () => {
    if (!results.length) return;
    const header = "特許番号,英語タイトル,日本語タイトル,公開日,企業,国,発明者,EPO要約,AI解説,Espacenet URL";
    const rows = results.map(p => [
      p.patent_number,
      '"'+(p.title_en||"").replace(/"/g,'""')+'"',
      '"'+(p.title_ja||"").replace(/"/g,'""')+'"',
      p.publication_date,
      '"'+(p.company_name||"").replace(/"/g,'""')+'"',
      p.country,
      '"'+(p.inventors||[]).join("; ").replace(/"/g,'""')+'"',
      '"'+(p.abstract_epo||"").replace(/"/g,'""')+'"',
      '"'+(p.summary_ja||"").replace(/"/g,'""')+'"',
      '"https://worldwide.espacenet.com/patent/search?q=pn%3D'+encodeURIComponent(p.patent_number)+'"',
    ].join(","));
    const blob = new Blob(["\uFEFF",[header,...rows].join("\n")],{type:"text/csv;charset=utf-8;"});
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "patents_search_results.csv"; link.click();
  };

const [claimsFetchPhase, setClaimsFetchPhase] = useState("idle");
  const [claimsFetchProgress, setClaimsFetchProgress] = useState({done:0, total:0, saved:0});
  const claimsFetchStop = useRef(false);

  const fetchAllClaims = async () => {
    if (!window.confirm(
      "絞り込み結果 "+totalCount+" 件の請求項・説明文をEPOから一括取得してDBに保存します。\n\n"+
      "※ DBに保存済みの特許はスキップします。\n"+
      "※ EPO APIクォータを消費します。\n"+
      "続けますか？"
    )) return;

    setClaimsFetchPhase("fetching");
    setClaimsFetchProgress({done:0, total:0, saved:0});
    claimsFetchStop.current = false;

    try {
     // 全件ページネーション取得
      const allPatents = [];
      let offset = 0;
      const PAGE = 1000;
      while (true) {
        const batch = await sbRpc("search_patents", {
          keyword:     keyword.trim()||null,
          inventor:    inventor.trim()||null,
          company_ids: selCompanies.length>0?selCompanies:null,
          countries:   selCountries.length>0?selCountries:null,
          from_date:   dateFrom||null,
          to_date:     dateTo||null,
          page_offset: offset,
          page_limit:  PAGE,
        });
        if (!batch || batch.length === 0) break;
        // 未取得のもののみ追加
        allPatents.push(...batch.filter(p =>
          !p.claims_independent && !p.description_text
        ));
        if (batch.length < PAGE) break;
        offset += PAGE;
        await new Promise(r => setTimeout(r, 200));
      }

      if (allPatents.length === 0) {
        setErr("すべての特許に請求項・説明文が取得済みです。");
        setClaimsFetchPhase("idle"); return;
      }

      setClaimsFetchProgress({done:0, total:allPatents.length, saved:0});
      let savedCount = 0;

      for (let i=0; i<allPatents.length; i++) {
        if (claimsFetchStop.current) break;
        const p = allPatents[i];
        setClaimsFetchProgress({done:i+1, total:allPatents.length, saved:savedCount});

        const patentObj = {
          ...p,
          docNum: p.patent_number?.replace(/^[A-Z]+/,"").replace(/[A-Z]+\d*$/,""),
          kind:   p.patent_number?.match(/[A-Z]\d*$/)?.[0]||"",
        };

        try {
          const [dR, cR] = await Promise.allSettled([
            fetchDescription(patentObj),
            fetchClaims(patentObj),
          ]);

          const patch = {};
          if (cR.status==="fulfilled"&&cR.value) patch.claims_independent = cR.value.independentClaims;
          if (dR.status==="fulfilled"&&dR.value) patch.description_text   = dR.value.text?.slice(0,30000);

          if (Object.keys(patch).length > 0) {
            await fetch(supabaseUrl+"/rest/v1/patents?patent_number=eq."+encodeURIComponent(p.patent_number), {
              method:"PATCH",
              headers:{"apikey":supabaseKey,"Authorization":"Bearer "+supabaseKey,"Content-Type":"application/json","Prefer":"return=minimal"},
              body:JSON.stringify(patch),
            });
            savedCount++;
            setClaimsFetchProgress({done:i+1, total:allPatents.length, saved:savedCount});
          }
        } catch(e) {
          console.warn("claims fetch failed:", p.patent_number, e.message);
        }

        if (i < allPatents.length-1) await new Promise(r=>setTimeout(r,400));
      }

      setClaimsFetchPhase("done");
      setErr("✅ 請求項・説明文の一括取得完了（"+savedCount+"/"+allPatents.length+"件 保存）");
    } catch(e) {
      setErr("一括取得エラー: "+e.message);
    }
    setClaimsFetchPhase("idle");
  };

  /* ★ 絞り込み結果の特許を一括AI解説（旧「AI解説生成」タブの機能を統合） */
  const [sumPhase,    setSumPhase]    = useState("idle"); // idle | fetching | generating
  const [sumProgress, setSumProgress] = useState({ done:0, total:0, saved:0 });
  const sumStop = useRef(false);

  const generateSummaries = async () => {
    if (!window.confirm(
      "絞り込み結果 "+totalCount+" 件の特許のAI解説（日本語タイトル＋要約）を一括生成してDBに保存します。\n\n"+
      "※ 解説が生成済みの特許はスキップします。\n"+
      "※ Claude APIを使用します。\n"+
      "続けますか？"
    )) return;

    setSumPhase("fetching");
    setSumProgress({ done:0, total:0, saved:0 });
    sumStop.current = false;

    try {
      // 絞り込み条件に合致する全件をページネーション取得
      const allPatents = [];
      let offset = 0;
      const PAGE = 1000;
      while (true) {
        const batch = await sbRpc("search_patents", {
          keyword:     keyword.trim()||null,
          inventor:    inventor.trim()||null,
          company_ids: selCompanies.length>0?selCompanies:null,
          countries:   selCountries.length>0?selCountries:null,
          from_date:   dateFrom||null,
          to_date:     dateTo||null,
          page_offset: offset,
          page_limit:  PAGE,
        });
        if (!batch || batch.length === 0) break;
        allPatents.push(...batch);
        if (batch.length < PAGE) break;
        offset += PAGE;
        await new Promise(r => setTimeout(r, 200));
      }

      // AI解説が未生成のものだけに絞る（summary_ja が無いもの）
      const targets = allPatents.filter(p => !p.summary_ja);
      if (targets.length === 0) {
        setErr("すべての特許にAI解説が生成済みです。");
        setSumPhase("idle"); return;
      }

      setSumPhase("generating");
      setSumProgress({ done:0, total:targets.length, saved:0 });
      const BATCH = 3;
      let savedCount = 0;

      for (let i = 0; i < targets.length; i += BATCH) {
        if (sumStop.current) break;
        const batch = targets.slice(i, i + BATCH);
        const list  = batch.map((p, idx) => {
          let e = (idx+1)+". ["+p.patent_number+"] "+p.title_en;
          if (p.abstract_epo) e += " / "+p.abstract_epo.slice(0, 100);
          return e;
        }).join("\n");

        try {
          const text = await claudePost(
            "You are a patent analyst. Analyze each patent below.\n\n"
            +"IMPORTANT: In NUM: field, use the EXACT patent number from [brackets], NOT the list number 1/2/3.\n\n"
            +"Reply ONLY (one line per patent):\n"
            +"NUM:<exact patent number from [brackets]>|Japanese title|4-5 sentence Japanese summary\n\n"
            + list, 1500);

          const batchResults = {};
          const numMap = {};
          batch.forEach(p => {
            numMap[p.patent_number] = p.patent_number;
            numMap[p.patent_number.replace(/\s/g,"").toUpperCase()] = p.patent_number;
          });
          text.split("\n").forEach(line => {
            if (!line.startsWith("NUM:")) return;
            const body = line.slice(4), f = body.indexOf("|"), s = body.indexOf("|", f+1);
            if (f < 0 || s < 0) return;
            const rawNum  = body.slice(0,f).trim();
            const jaTitle = body.slice(f+1,s).trim();
            const summary = body.slice(s+1).trim();
            const exactNum = numMap[rawNum]
              || numMap[rawNum.replace(/\s/g,"").toUpperCase()]
              || batch.find(p => p.patent_number.includes(rawNum) || rawNum.includes(p.patent_number))?.patent_number;
            if (exactNum && summary) batchResults[exactNum] = { jaTitle, summary };
          });

          // ai_summaries へ保存
          const rows = Object.entries(batchResults).map(([num, v]) => ({
            patent_number: num, title_ja: v.jaTitle||null, summary_ja: v.summary, analyzed_at: new Date().toISOString(),
          }));
          if (rows.length > 0) {
            await sbUpsert("ai_summaries", rows, "patent_number");
            savedCount += rows.length;
          }

          // patents.title_ja にも反映
          for (const [num, v] of Object.entries(batchResults)) {
            if (v.jaTitle) {
              fetch(supabaseUrl+"/rest/v1/patents?patent_number=eq."+encodeURIComponent(num), {
                method:"PATCH",
                headers:{"apikey":supabaseKey,"Authorization":"Bearer "+supabaseKey,"Content-Type":"application/json","Prefer":"return=minimal"},
                body:JSON.stringify({title_ja:v.jaTitle})
              }).catch(e => console.warn("title_ja patch failed:", num, e));
            }
          }

          // 画面上の検索結果にも反映
          setResults(prev => prev.map(p => batchResults[p.patent_number]
            ? { ...p, title_ja: batchResults[p.patent_number].jaTitle||p.title_ja, summary_ja: batchResults[p.patent_number].summary }
            : p));
        } catch(e) {
          console.warn("summary batch failed:", e.message);
        }

        setSumProgress({ done:Math.min(i+BATCH, targets.length), total:targets.length, saved:savedCount });
        if (i + BATCH < targets.length) await new Promise(r => setTimeout(r, 1500));
      }

      setErr("✅ AI解説の一括生成完了（"+savedCount+"/"+targets.length+"件 保存）");
    } catch(e) {
      setErr("AI解説一括生成エラー: "+e.message);
    }
    setSumPhase("idle");
  };

  const doAnalyzeResults = async (deep = false) => {
    setAnalyzePhase("analyzing"); setAnalysis(null);
    try {
      const filterDesc = [
        selCompanies.length > 0 ? "企業: "+selCompanies.map(id=>companies.find(c=>c.id===id)?.name||id).join(", ") : null,
        selCountries.length > 0 ? "国: "+selCountries.join("/") : null,
        keyword  ? 'キーワード: "'+keyword+'"'   : null,
        inventor ? '発明者: "'+inventor+'"'       : null,
        dateFrom && dateTo ? "期間: "+dateFrom+" 〜 "+dateTo : null,
      ].filter(Boolean).join(" / ") || "フィルターなし";

      // ① 絞り込み条件に合致する全件を取得
      const allData = await sbRpc("search_patents", {
        keyword:     keyword.trim() || null,
        inventor:    inventor.trim() || null,
        company_ids: selCompanies.length > 0 ? selCompanies : null,
        countries:   selCountries.length > 0 ? selCountries : null,
        from_date:   dateFrom || null,
        to_date:     dateTo   || null,
        page_offset: 0,
        page_limit:  99999,
      });
      const allPatents = allData || [];
      if (allPatents.length === 0) {
        setErr("分析対象の特許がありません。先に検索を実行してください。");
        setAnalyzePhase("idle"); return;
      }

      // ② モード別パラメーター
      const BATCH_SIZE    = deep ? 50  : 100;
      const ABSTRACT_WORDS = deep ? 200 : 80;
      const CLAIMS_WORDS   = deep ? 300 : 50;
      const DESC_WORDS     = deep ? 300 : 0;    // 標準は含まない
      const BATCH_TOKENS   = deep ? 2000 : 1200;
      const SYNTH_TOKENS   = deep ? 2500 : 2000;

      // deepモード：クレーム・説明文保有率を事前集計して表示
      if (deep) {
        const claimsCount = allPatents.filter(p => p.claims_independent).length;
        const descCount   = allPatents.filter(p => p.description_text).length;
        setAnalysis({
          _progress: { done: 0, total: 0, phase: "batch" },
          _deepStats: { claimsCount, descCount, total: allPatents.length },
        });
        await new Promise(r => setTimeout(r, 200));
      }

      // ③ バッチに分割
      const batches = [];
      for (let i = 0; i < allPatents.length; i += BATCH_SIZE) {
        batches.push(allPatents.slice(i, i + BATCH_SIZE));
      }
      const totalBatches = batches.length;
      const batchResults = [];

      // ④ バッチ分析
      for (let b = 0; b < totalBatches; b++) {
        setAnalysis(prev => ({
          ...(prev || {}),
          _progress: { done: b, total: totalBatches, phase: "batch" },
        }));
        const batch = batches[b];
        const limitWords = (text, maxWords) => {
          if (!text) return "";
          if (maxWords >= 9999) return text;
          return text.split(/\s+/).slice(0, maxWords).join(" ");
        };
        const list = batch.map((p, i) => {
          let e = (i+1)+". ["+p.country+"] "+p.title_en+" ("+p.publication_date+")";
          if (p.company_name) e += " — "+p.company_name;
          if (p.abstract_epo)       e += "\n   Abstract: "  + limitWords(p.abstract_epo, ABSTRACT_WORDS);
          if (p.claims_independent) e += "\n   Key Claim: " + limitWords(p.claims_independent, CLAIMS_WORDS);
          if (deep && p.description_text) e += "\n   Description: " + limitWords(p.description_text, DESC_WORDS);
          return e;
        }).join("\n");

        const batchText = await claudePost(
          "You are a patent analyst. Analyze this batch and extract key technology patterns. Reply ONLY in this exact format:\n"
          +"BCAT1:category name|percentage|one line description\n"
          +"BCAT2:category name|percentage|one line description\n"
          +"BCAT3:category name|percentage|one line description\n"
          +"BCAT4:category name|percentage|one line description\n"
          +"BCAT5:category name|percentage|one line description\n"
          +"BTREND1:trend title|2 sentence explanation in Japanese\n"
          +"BTREND2:trend title|2 sentence explanation in Japanese\n"
          +"BTREND3:trend title|2 sentence explanation in Japanese\n"
          +"BNOTABLE:notable patent title and innovation in Japanese (2 sentences)\n\n"
          +"Batch "+(b+1)+"/"+totalBatches+" ("+batch.length+" of "+allPatents.length+" patents):\n"+list
          , BATCH_TOKENS
        );

        const getV = p => { const l = batchText.split("\n").find(l => l.startsWith(p)); return l ? l.slice(p.length).trim() : ""; };
        const parseBar = p => { const pts = getV(p).split("|"); return { name:pts[0]||"", pct:parseInt(pts[1]||"0",10), desc:pts[2]||"" }; };
        const parseTrend = p => { const v = getV(p); const i = v.indexOf("|"); return { title:i>=0?v.slice(0,i):v, body:i>=0?v.slice(i+1):"" }; };

        batchResults.push({
          batchNum:   b + 1,
          count:      batch.length,
          categories: [parseBar("BCAT1:"),parseBar("BCAT2:"),parseBar("BCAT3:"),parseBar("BCAT4:"),parseBar("BCAT5:")].filter(c=>c.name),
          trends:     [parseTrend("BTREND1:"),parseTrend("BTREND2:"),parseTrend("BTREND3:")].filter(t=>t.title),
          notable:    getV("BNOTABLE:"),
        });

        if (b < totalBatches - 1) await new Promise(r => setTimeout(r, 600));
      }

      // ⑤ 統合分析
      setAnalysis(prev => ({
        ...(prev || {}),
        _progress: { done: totalBatches, total: totalBatches, phase: "synthesis" },
      }));

      const batchSummary = batchResults.map(br =>
        "--- バッチ "+br.batchNum+" ("+br.count+"件) ---\n"
        +"カテゴリー: "+br.categories.map(c=>c.name+"("+c.pct+"%)").join(", ")+"\n"
        +"トレンド: "+br.trends.map(t=>t.title).join(" / ")+"\n"
        +"注目特許: "+br.notable
      ).join("\n\n");

      // ⑤-A 統合分析前半：カテゴリー＋トレンド
      const trendInstruction = deep
        ? "TREND1:trend title|8 sentence detailed explanation citing specific claim language in Japanese\n"
         +"TREND2:trend title|8 sentence detailed explanation citing specific claim language in Japanese\n"
         +"TREND3:trend title|8 sentence detailed explanation citing specific claim language in Japanese"
        : "TREND1:trend title|3-4 sentence detailed explanation in Japanese\n"
         +"TREND2:trend title|3-4 sentence detailed explanation in Japanese\n"
         +"TREND3:trend title|3-4 sentence detailed explanation in Japanese";

      const synthText1 = await claudePost(
        "You are a patent intelligence analyst. Based on the batch analysis below, synthesize the technology category breakdown and key trends.\n\n"
        +"Total: "+allPatents.length+" patents ("+totalBatches+" batches). Filter: "+filterDesc+"\n\n"
        +"Batch summaries:\n"+batchSummary+"\n\n"
        +"Reply ONLY in this exact format:\n"
        +"CAT1:category name|percentage|detailed one-line description\n"
        +"CAT2:category name|percentage|detailed one-line description\n"
        +"CAT3:category name|percentage|detailed one-line description\n"
        +"CAT4:category name|percentage|detailed one-line description\n"
        +"CAT5:category name|percentage|detailed one-line description\n"
        +trendInstruction
        , SYNTH_TOKENS
      );

      await new Promise(r => setTimeout(r, 800));

      // ⑤-B 統合分析後半：2050年シナリオ・戦略・注目特許×2
      const patentInstruction = deep
        ? "PATENT1:5 sentence description of the 1st most notable patent, its claim scope, and inventive mechanism in Japanese\n"
         +"PATENT2:5 sentence description of the 2nd most notable patent, its claim scope, and inventive mechanism in Japanese"
        : "PATENT:2-3 sentence description of the most notable patent and its innovation in Japanese";

      const synthText2 = await claudePost(
        "You are a patent intelligence analyst. Based on the batch analysis below, write the 2050 scenario, strategic implications, and most notable patents.\n\n"
        +"Total: "+allPatents.length+" patents ("+totalBatches+" batches). Filter: "+filterDesc+"\n\n"
        +"Batch summaries:\n"+batchSummary+"\n\n"
        +"Reply ONLY in this exact format:\n"
        +"IMPACT:5-6 sentence comprehensive 2050 social transformation scenario in Japanese\n"
        +"STRATEGIC:4-5 sentence competitive advantage and strategic implications in Japanese\n"
        +patentInstruction
        , SYNTH_TOKENS
      );

      const getV1 = p => { const l = synthText1.split("\n").find(l => l.startsWith(p)); return l ? l.slice(p.length).trim() : ""; };
      const getV2 = p => { const l = synthText2.split("\n").find(l => l.startsWith(p)); return l ? l.slice(p.length).trim() : ""; };
      const parseBar2 = p => { const pts = getV1(p).split("|"); return { name:pts[0]||"", pct:parseInt(pts[1]||"0",10), desc:pts[2]||"" }; };
      const parseTrend2 = p => { const v = getV1(p); const i = v.indexOf("|"); return { title:i>=0?v.slice(0,i):v, body:i>=0?v.slice(i+1):"" }; };

      const r = {
        deep,
        filterDesc,
        totalCount:   allPatents.length,
        totalBatches,
        batchResults,
        categories:   [parseBar2("CAT1:"),parseBar2("CAT2:"),parseBar2("CAT3:"),parseBar2("CAT4:"),parseBar2("CAT5:")].filter(c=>c.name),
        trends:       [parseTrend2("TREND1:"),parseTrend2("TREND2:"),parseTrend2("TREND3:")].filter(t=>t.title),
        impact2050:   getV2("IMPACT:"),
        strategic:    getV2("STRATEGIC:"),
        topPatent:    deep ? null : getV2("PATENT:"),
        topPatent1:   deep ? getV2("PATENT1:") : null,
        topPatent2:   deep ? getV2("PATENT2:") : null,
      };
      setAnalysis(r);
      setAnalyzePhase("done"); setShowAnalysis(true);

      // ★ DBに保存
      const searchCompanyId  = selCompanies.length === 1 ? selCompanies[0] : null;
      const searchCompanyName = selCompanies.length === 1
        ? companies.find(c => c.id === selCompanies[0])?.name || selCompanies[0]
        : filterDesc;
      const saveFrom = dateFrom || "2000-01-01";
      const saveTo   = dateTo   || "2099-12-31";
      // deepモードの注目特許は①②を連結して top_patent に保存
      const topPatentForDB = deep
        ? [r.topPatent1 ? "①"+r.topPatent1 : "", r.topPatent2 ? "②"+r.topPatent2 : ""].filter(Boolean).join("\n\n")
        : r.topPatent;
      await sbSaveAnalysis({
        company_id:    searchCompanyId || ("search__" + encodeURIComponent(filterDesc).replace(/%/g,"").slice(0,30)),
        company_name:  searchCompanyName,
        date_from:     saveFrom,
        date_to:       saveTo,
        total_patents: allPatents.length,
        categories:    JSON.stringify(r.categories),
        trends:        JSON.stringify(r.trends),
        impact2050:    r.impact2050,
        strategic:     r.strategic,
        top_patent:    topPatentForDB,
        analyzed_at:   new Date().toISOString(),
      });
    } catch(e) {
      // ★ 途中まで取得できていたバッチ結果があれば簡易表示する
      if (typeof batchResults !== "undefined" && batchResults.length > 0) {
        const partialCategories = {};
        batchResults.forEach(br => {
          br.categories.forEach(c => {
            if (!partialCategories[c.name]) partialCategories[c.name] = { name:c.name, pct:0, desc:c.desc, count:0 };
            partialCategories[c.name].pct += c.pct;
            partialCategories[c.name].count += 1;
          });
        });
        const avgCategories = Object.values(partialCategories).map(c => ({
          name: c.name, pct: Math.round(c.pct / c.count), desc: c.desc
        })).sort((a,b)=>b.pct-a.pct).slice(0,5);

        setAnalysis({
          filterDesc: "（部分結果："+batchResults.length+"/"+(typeof totalBatches!=="undefined"?totalBatches:"?")+"バッチ完了時点で中断）",
          totalCount: batchResults.reduce((s,br)=>s+br.count,0),
          totalBatches: batchResults.length,
          batchResults,
          categories: avgCategories,
          trends: batchResults.flatMap(br=>br.trends).slice(0,3),
          impact2050: "",
          strategic: "",
          topPatent: batchResults.map(br=>br.notable).filter(Boolean).join(" / "),
        });
        setAnalyzePhase("done"); setShowAnalysis(true);
        setErr("⚠️ 分析が途中で中断されました（"+batchResults.length+"バッチ分のみ表示・統合分析は未実施）。再度実行してください。エラー: "+e.message);
      } else {
        setErr("AI分析エラー: "+e.message);
        setAnalyzePhase("idle");
      }
    }
  };

  const toggleCompany = id => setSelCompanies(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev,id]);
  const toggleCountry = ct => setSelCountries(prev => prev.includes(ct) ? prev.filter(x=>x!==ct) : [...prev,ct]);
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div style={{display:"flex",flex:1,overflow:"hidden"}}>

      {/* 左フィルターパネル */}
      <div style={{width:220,borderRight:"1px solid "+c.border,background:c.bg1,overflowY:"auto",padding:12,flexShrink:0}}>
        <div style={{fontSize:11,fontWeight:700,color:c.muted,marginBottom:10,letterSpacing:".06em"}}>検索・フィルター</div>

        <div style={{marginBottom:12}}>
          <div style={{fontSize:11,color:c.muted,marginBottom:4}}>キーワード</div>
          <input value={keyword} onChange={e=>setKeyword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doSearch(0)}
            placeholder="タイトル・要約・AI解説"
            style={{width:"100%",padding:"7px 10px",borderRadius:7,border:"1px solid "+c.border,background:c.bg2,color:c.text,fontSize:12,outline:"none",boxSizing:"border-box"}}/>
  {/* ★ 検索ヒント追加 */}
          <div style={{fontSize:9,color:c.muted,marginTop:4,lineHeight:1.8}}>
            <span style={{color:c.cyan}}>AND:</span> neural network　
            <span style={{color:c.green}}>OR:</span> battery OR lithium　
            <span style={{color:"#f87171"}}>NOT:</span> AI NOT image
          </div>
        </div>

        <div style={{marginBottom:12}}>
          <div style={{fontSize:11,color:c.muted,marginBottom:4}}>発明者名</div>
          <input value={inventor} onChange={e=>setInventor(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doSearch(0)}
            placeholder="例: Smith / 田中"
            style={{width:"100%",padding:"7px 10px",borderRadius:7,border:"1px solid "+c.border,background:c.bg2,color:c.text,fontSize:12,outline:"none",boxSizing:"border-box"}}/>
        </div>

        <div style={{marginBottom:12}}>
          <div style={{fontSize:11,color:c.muted,marginBottom:4}}>国コード</div>
          <div style={{display:"flex",gap:4}}>
            {["US","WO","JP"].map(ct => (
              <button key={ct} onClick={() => toggleCountry(ct)}
                style={{flex:1,padding:"4px",borderRadius:5,border:"1px solid "+(selCountries.includes(ct)?COUNTRY_COLORS[ct]:c.border),background:selCountries.includes(ct)?"#0a1e2a":"transparent",color:selCountries.includes(ct)?COUNTRY_COLORS[ct]:c.muted,fontSize:11,fontWeight:700,cursor:"pointer"}}>
                {ct}
              </button>
            ))}
          </div>
        </div>

        <div style={{marginBottom:12}}>
          <div style={{fontSize:11,color:c.muted,marginBottom:4}}>公開日</div>
          <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} style={{width:"100%",padding:"5px 8px",borderRadius:5,border:"1px solid "+c.border,background:c.bg2,color:c.text,fontSize:11,outline:"none",marginBottom:4,boxSizing:"border-box"}}/>
          <input type="date" value={dateTo}   onChange={e=>setDateTo(e.target.value)}   style={{width:"100%",padding:"5px 8px",borderRadius:5,border:"1px solid "+c.border,background:c.bg2,color:c.text,fontSize:11,outline:"none",boxSizing:"border-box"}}/>
        </div>

        <div style={{marginBottom:12}}>
          <div style={{fontSize:11,color:c.muted,marginBottom:4}}>企業</div>
          <div style={{maxHeight:280,overflowY:"auto"}}>
            {companies.map(co => (
  <div key={co.id} onClick={() => toggleCompany(co.id)}
    style={{display:"flex",alignItems:"center",gap:6,padding:"5px 6px",borderRadius:5,marginBottom:1,cursor:"pointer",
      background:selCompanies.includes(co.id)?"#0c2d42":"transparent"}}>
    <span style={{fontSize:11}}>{co.flag}</span>
    <div style={{flex:1,minWidth:0}}>
      <div style={{fontSize:11,color:selCompanies.includes(co.id)?c.cyan:c.text}}>{co.name}</div>
      {co._stats ? (
        <div style={{fontSize:9,color:c.muted,marginTop:1}}>
          {co._stats.oldest_date?.slice(0,7)} 〜 {co._stats.newest_date?.slice(0,7)}
          <span style={{opacity:.6}}> ({Number(co._stats.patent_count).toLocaleString()}件)</span>
        </div>
      ) : (
        <div style={{fontSize:9,color:c.muted,opacity:.4,marginTop:1}}>未取得</div>
      )}
    </div>
    {selCompanies.includes(co.id)&&<span style={{fontSize:10,color:c.cyan}}>✓</span>}
  </div>
))}
          </div>
        </div>

        <button onClick={() => doSearch(0)} disabled={loading}
          style={{width:"100%",padding:"8px",borderRadius:7,border:"none",background:c.purple,color:"#fff",fontWeight:700,fontSize:12,cursor:loading?"not-allowed":"pointer",marginBottom:6}}>
          {loading ? "検索中..." : "🔍 検索"}
        </button>
        {/* ★ 表示中の特許をAI分析 */}
        <button onClick={() => doAnalyzeResults(false)} disabled={!results.length||analyzePhase==="analyzing"}
          style={{width:"100%",padding:"8px",borderRadius:7,border:"none",background:!results.length||analyzePhase==="analyzing"?"#1a3550":c.amber,color:!results.length||analyzePhase==="analyzing"?c.muted:"#000",fontWeight:700,fontSize:12,cursor:!results.length||analyzePhase==="analyzing"?"not-allowed":"pointer",marginBottom:4}}>
          {analyzePhase==="analyzing" && !analysis?.deep ? "🤖 分析中..." : "🤖 AI分析（標準）（全"+totalCount+"件）"}
        </button>
        <button onClick={() => doAnalyzeResults(true)} disabled={!results.length||analyzePhase==="analyzing"}
          style={{width:"100%",padding:"8px",borderRadius:7,border:"none",background:!results.length||analyzePhase==="analyzing"?"#1a3550":"#6d28d9",color:!results.length||analyzePhase==="analyzing"?c.muted:"#fff",fontWeight:700,fontSize:12,cursor:!results.length||analyzePhase==="analyzing"?"not-allowed":"pointer",marginBottom:6}}>
          {analyzePhase==="analyzing" && analysis?.deep ? "🔬 詳細分析中（全文）..." : "🔬 詳細AI分析（全文）（全"+totalCount+"件）"}
        </button>
        <button onClick={downloadCSV} disabled={!results.length}
          style={{width:"100%",padding:"8px",borderRadius:7,border:"1px solid "+(results.length?c.green:c.border),background:"transparent",color:results.length?c.green:c.muted,fontSize:12,cursor:results.length?"pointer":"not-allowed"}}>
          📥 CSV保存（{results.length}件）
        </button>

<button onClick={fetchAllClaims}
          disabled={!results.length||claimsFetchPhase!=="idle"}
          style={{width:"100%",padding:"8px",borderRadius:7,border:"1px solid "+(results.length&&claimsFetchPhase==="idle"?c.purple:c.border),background:"transparent",color:results.length&&claimsFetchPhase==="idle"?c.purple:c.muted,fontSize:11,cursor:results.length&&claimsFetchPhase==="idle"?"pointer":"not-allowed",marginBottom:6}}>
          {claimsFetchPhase==="fetching"
            ? "📡 "+claimsFetchProgress.done+"/"+claimsFetchProgress.total+"件取得中（保存:"+claimsFetchProgress.saved+"件）"
            : "📡 請求項・説明文を一括取得してDB保存"}
        </button>
        {claimsFetchPhase==="fetching" && (
          <>
            <div style={{height:4,background:c.bg2,borderRadius:2,overflow:"hidden",marginBottom:4}}>
              <div style={{height:"100%",borderRadius:2,background:c.purple,
                width:claimsFetchProgress.total>0
                  ?(claimsFetchProgress.done/claimsFetchProgress.total*100)+"%":"0%",
                transition:"width .3s"}}/>
            </div>
            <button onClick={()=>claimsFetchStop.current=true}
              style={{width:"100%",padding:"4px",borderRadius:5,border:"1px solid "+c.border,background:"transparent",color:c.amber,fontSize:10,cursor:"pointer",marginBottom:4}}>
              ⏹ 停止
            </button>
          </>
        )}

        {/* ★ 絞り込み結果を一括AI解説 */}
        <button onClick={generateSummaries}
          disabled={!results.length||sumPhase!=="idle"}
          style={{width:"100%",padding:"8px",borderRadius:7,border:"1px solid "+(results.length&&sumPhase==="idle"?"#e879f9":c.border),background:"transparent",color:results.length&&sumPhase==="idle"?"#e879f9":c.muted,fontSize:11,cursor:results.length&&sumPhase==="idle"?"pointer":"not-allowed",marginBottom:6}}>
          {sumPhase==="fetching"
            ? "✨ 対象特許を取得中..."
            : sumPhase==="generating"
              ? "✨ "+sumProgress.done+"/"+sumProgress.total+"件生成中（保存:"+sumProgress.saved+"件）"
              : "✨ AI解説を一括生成してDB保存"}
        </button>
        {sumPhase==="generating" && (
          <>
            <div style={{height:4,background:c.bg2,borderRadius:2,overflow:"hidden",marginBottom:4}}>
              <div style={{height:"100%",borderRadius:2,background:"linear-gradient(90deg,#e879f9,#a78bfa)",
                width:sumProgress.total>0?(sumProgress.done/sumProgress.total*100)+"%":"0%",
                transition:"width .3s"}}/>
            </div>
            <button onClick={()=>sumStop.current=true}
              style={{width:"100%",padding:"4px",borderRadius:5,border:"1px solid "+c.border,background:"transparent",color:c.amber,fontSize:10,cursor:"pointer",marginBottom:4}}>
              ⏹ 停止
            </button>
          </>
        )}

        {(selCompanies.length>0||selCountries.length>0) && (
          <button onClick={() => { setSelCompanies([]); setSelCountries([]); setInventor(''); }}
            style={{width:"100%",padding:"5px",borderRadius:5,border:"1px solid "+c.border,background:"transparent",color:c.muted,fontSize:10,cursor:"pointer",marginTop:6}}>
            フィルターをリセット
          </button>
        )}
      </div>

      {/* 右：検索結果 */}
      <div style={{flex:1,overflowY:"auto",padding:16}}>
        {err && <div style={{padding:"6px 12px",background:"#1a1000",borderRadius:6,fontSize:11,color:c.amber,marginBottom:12}}>{err}</div>}

        {/* ★ AI分析結果パネル */}
        {analyzePhase==="analyzing" && (
          <div style={{padding:"20px 24px",background:c.bg1,borderRadius:10,border:"1px solid "+(analysis?.deep?"#6d28d9":c.amber),marginBottom:16}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
              <span style={{fontSize:18}}>{analysis?.deep?"🔬":"🤖"}</span>
              <span style={{fontSize:13,color:analysis?.deep?"#a78bfa":c.amber,fontWeight:600}}>
                {analysis?._progress?.phase === "synthesis"
                  ? "統合分析中（全バッチを統合しています）..."
                  : analysis?._progress
                    ? (analysis.deep?"【詳細モード】":"")+"バッチ分析中... "+analysis._progress.done+"/"+analysis._progress.total+"バッチ完了"
                    : "全件取得中..."}
              </span>
            </div>
            {analysis?._deepStats && (
              <div style={{fontSize:10,color:"#a78bfa",marginBottom:8,padding:"4px 8px",background:"#1e1040",borderRadius:4}}>
                全文クレーム: {analysis._deepStats.claimsCount}件/{analysis._deepStats.total}件
                （{Math.round(analysis._deepStats.claimsCount/analysis._deepStats.total*100)}%）　
                説明文: {analysis._deepStats.descCount}件/{analysis._deepStats.total}件
                （{Math.round(analysis._deepStats.descCount/analysis._deepStats.total*100)}%）
              </div>
            )}
            {analysis?._progress && (
              <>
                <div style={{height:5,background:c.bg2,borderRadius:3,overflow:"hidden",marginBottom:6}}>
                  <div style={{height:"100%",borderRadius:3,
                    background:analysis._progress.phase==="synthesis"
                      ? "linear-gradient(90deg,"+c.green+",#6ee7b7)"
                      : analysis.deep
                        ? "linear-gradient(90deg,#6d28d9,#a78bfa)"
                        : "linear-gradient(90deg,"+c.amber+",#fcd34d)",
                    width:analysis._progress.phase==="synthesis"
                      ? "100%"
                      : (analysis._progress.done/analysis._progress.total*100)+"%",
                    transition:"width .4s"}}/>
                </div>
                <div style={{fontSize:10,color:c.muted}}>
                  {analysis._progress.phase==="synthesis"
                    ? "全"+analysis._progress.total+"バッチの結果を統合中..."
                    : analysis._progress.done+"バッチ完了 / 残り"+(analysis._progress.total-analysis._progress.done)+"バッチ（1バッチ="+(analysis.deep?"20":"50")+"件）"}
                </div>
              </>
            )}
          </div>
        )}
        {analysis && analysis.categories && showAnalysis && (
          <div style={{background:c.bg1,borderRadius:10,border:"1px solid "+(analysis.deep?"#6d28d9":c.amber),marginBottom:16,overflow:"hidden"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 14px",background:analysis.deep?"#160d30":"#1a1200",borderBottom:"1px solid "+c.border,flexWrap:"wrap"}}>
              <span style={{fontSize:12,fontWeight:700,color:analysis.deep?"#a78bfa":c.amber}}>{analysis.deep?"🔬 詳細AI分析結果":"🤖 AI分析結果"}</span>
              {analysis.deep && <span style={{fontSize:10,color:"#a78bfa",padding:"1px 7px",borderRadius:4,background:"#2d1060",border:"1px solid #6d28d9"}}>全文クレーム・説明文使用</span>}
              <span style={{fontSize:11,color:c.cyan,padding:"1px 7px",borderRadius:4,background:"#0c2d42",border:"1px solid "+c.border}}>{analysis.totalCount}件</span>
              {analysis.totalBatches>1 && <span style={{fontSize:11,color:c.green,padding:"1px 7px",borderRadius:4,background:"#0a1e0a",border:"1px solid "+c.green}}>{analysis.totalBatches}バッチ分析</span>}
              <span style={{fontSize:11,color:c.muted}}>{analysis.filterDesc}</span>
              <span style={{fontSize:10,color:c.green,marginLeft:4}}>✅ DB保存済み</span>
              <button
                onClick={() => printToPDF(
                  "絞り込み分析_"+analysis.filterDesc.slice(0,20),
                  generatePortfolioHTML({name: analysis.filterDesc}, analysis, {total_patents: analysis.totalCount, analyzed_at: new Date().toISOString()})
                )}
                style={{padding:"3px 10px",borderRadius:5,border:"1px solid #16a34a",background:"transparent",color:"#16a34a",fontSize:11,fontWeight:600,cursor:"pointer"}}>
                📄 PDF出力
              </button>
              <button onClick={() => setShowAnalysis(false)} style={{marginLeft:"auto",fontSize:11,color:c.muted,background:"transparent",border:"none",cursor:"pointer"}}>▲ 閉じる</button>
            </div>
            <div style={{padding:14,display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div>
                <div style={{fontSize:11,fontWeight:700,color:c.cyan,marginBottom:8}}>技術カテゴリー分類</div>
                {analysis.categories.map((cat,i) => (
                  <div key={i} style={{marginBottom:8}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:11,color:c.text}}>{cat.name}</span><span style={{fontSize:11,color:c.cyan,fontWeight:700}}>{cat.pct}%</span></div>
                    <div style={{height:5,background:c.bg2,borderRadius:3,overflow:"hidden",marginBottom:2}}><div style={{height:"100%",width:cat.pct+"%",background:"linear-gradient(90deg,"+c.cyan+",#7dd3fc)",borderRadius:3}}/></div>
                    <div style={{fontSize:10,color:c.muted}}>{cat.desc}</div>
                  </div>
                ))}
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <div>
                  <div style={{fontSize:11,fontWeight:700,color:analysis.deep?"#a78bfa":c.amber,marginBottom:6}}>主要イノベーション動向</div>
                  {analysis.trends.map((t,i) => (
                    <div key={i} style={{marginBottom:8,paddingLeft:8,borderLeft:"2px solid "+(analysis.deep?"#6d28d9":c.amber)}}>
                      <div style={{fontSize:11,fontWeight:600,color:c.text,marginBottom:2}}>{t.title}</div>
                      <div style={{fontSize:10,color:c.muted,lineHeight:1.6}}>{t.body}</div>
                    </div>
                  ))}
                </div>
                <div style={{padding:"8px 10px",background:c.bg2,borderRadius:6}}>
                  <div style={{fontSize:10,fontWeight:700,color:c.green,marginBottom:4}}>2050年シナリオ</div>
                  <div style={{fontSize:11,color:c.text,lineHeight:1.65}}>{analysis.impact2050}</div>
                </div>
                <div style={{padding:"8px 10px",background:c.bg2,borderRadius:6}}>
                  <div style={{fontSize:10,fontWeight:700,color:c.purple,marginBottom:4}}>戦略的示唆</div>
                  <div style={{fontSize:11,color:c.text,lineHeight:1.65}}>{analysis.strategic}</div>
                </div>
                {/* 標準モード：注目特許1件 */}
                {analysis.topPatent && (
                  <div style={{padding:"8px 10px",background:c.bg2,borderRadius:6,border:"1px solid "+c.cyan}}>
                    <div style={{fontSize:10,color:c.cyan,marginBottom:3}}>★ 最注目特許</div>
                    <div style={{fontSize:11,color:c.text,lineHeight:1.5}}>{analysis.topPatent}</div>
                  </div>
                )}
                {/* 詳細モード：注目特許2件 */}
                {analysis.topPatent1 && (
                  <div style={{padding:"8px 10px",background:"#0d0820",borderRadius:6,border:"1px solid #6d28d9"}}>
                    <div style={{fontSize:10,color:"#a78bfa",marginBottom:3}}>★ 最注目特許①</div>
                    <div style={{fontSize:11,color:c.text,lineHeight:1.65}}>{analysis.topPatent1}</div>
                  </div>
                )}
                {analysis.topPatent2 && (
                  <div style={{padding:"8px 10px",background:"#0d0820",borderRadius:6,border:"1px solid #6d28d9"}}>
                    <div style={{fontSize:10,color:"#a78bfa",marginBottom:3}}>★ 最注目特許②</div>
                    <div style={{fontSize:11,color:c.text,lineHeight:1.65}}>{analysis.topPatent2}</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        {analysis && analysis.categories && !showAnalysis && (
          <button onClick={() => setShowAnalysis(true)} style={{width:"100%",padding:"6px",borderRadius:6,border:"1px solid "+c.amber,background:"transparent",color:c.amber,fontSize:11,cursor:"pointer",marginBottom:12}}>
            ▼ AI分析結果を表示する
          </button>
        )}

        <div style={{fontSize:11,color:c.muted,marginBottom:12}}>
          {loading ? "検索中..." : totalCount.toLocaleString()+"件 / "+totalPages+"ページ中 "+(page+1)+"ページ"}
        </div>

        {results.map((p, i) => {
          const ctryColor = COUNTRY_COLORS[p.country] || "#94a3b8";
          const url = "https://worldwide.espacenet.com/patent/search?q=pn%3D"+encodeURIComponent(p.patent_number);
          const isDetail = detailPatent?.patent_number === p.patent_number;
          // DBに蓄積されているデータの有無
          const hasSummary  = !!p.summary_ja;
          const hasClaims   = !!p.claims_independent;
          const hasDesc     = !!p.description_text;
          const hasDetail   = !!(p.score_novelty || p.problem);
          return (
            <div key={p.patent_number+i} style={{...card,marginBottom:10,border:"1px solid "+(isDetail?c.purple:c.border)}}>
              <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                <span style={{fontSize:10,fontWeight:700,color:ctryColor,padding:"1px 6px",borderRadius:3,border:"1px solid "+ctryColor,background:"#030b14",flexShrink:0,marginTop:2}}>{p.country}</span>
                <div style={{flex:1,minWidth:0}}>
                  {/* タイトル */}
                  <div style={{fontSize:13,color:c.text,lineHeight:1.4,marginBottom:3}}>{p.title_en}</div>
                  {p.title_ja && <div style={{fontSize:13,fontWeight:600,color:c.purple,marginBottom:5}}>{p.title_ja}</div>}

                  {/* メタ情報 */}
                  <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:6}}>
                    <span style={{fontSize:11,color:c.cyan,padding:"1px 6px",borderRadius:4,background:"#0c2d42",border:"1px solid "+c.border}}>{p.company_name}</span>
                    <span style={{fontSize:11,color:c.muted,fontFamily:"monospace"}}>{p.patent_number}</span>
                    <span style={{fontSize:11,color:c.muted}}>{p.publication_date}</span>
                    <a href={url} target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:c.cyan,textDecoration:"none",padding:"1px 7px",borderRadius:4,border:"1px solid "+c.border,background:c.bg2}}>Espacenet →</a>
                  </div>

                  {/* DB蓄積データのバッジ */}
                  <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:8}}>
                    {hasSummary  && <span style={{fontSize:9,color:"#e879f9",padding:"1px 6px",borderRadius:3,border:"1px solid #e879f9",opacity:.8}}>AI解説</span>}
                    {hasClaims   && <span style={{fontSize:9,color:c.purple, padding:"1px 6px",borderRadius:3,border:"1px solid "+c.purple,opacity:.8}}>請求項</span>}
                    {hasDesc     && <span style={{fontSize:9,color:c.cyan,   padding:"1px 6px",borderRadius:3,border:"1px solid "+c.cyan,  opacity:.8}}>説明文</span>}
                    {hasDetail   && <span style={{fontSize:9,color:c.green,  padding:"1px 6px",borderRadius:3,border:"1px solid "+c.green, opacity:.8}}>詳細分析</span>}
                  </div>

                  {/* 評価スコア */}
                  {hasDetail && (
                    <div style={{display:"flex",gap:6,marginBottom:8}}>
                      {p.score_novelty    && <span style={{fontSize:10,color:c.cyan,  padding:"1px 6px",borderRadius:4,border:"1px solid "+c.cyan,  opacity:.8}}>革新性 {p.score_novelty}/10</span>}
                      {p.score_impact     && <span style={{fontSize:10,color:c.green, padding:"1px 6px",borderRadius:4,border:"1px solid "+c.green, opacity:.8}}>社会影響 {p.score_impact}/10</span>}
                      {p.score_commercial && <span style={{fontSize:10,color:c.amber, padding:"1px 6px",borderRadius:4,border:"1px solid "+c.amber, opacity:.8}}>商業価値 {p.score_commercial}/10</span>}
                    </div>
                  )}

                  {/* 発明者 */}
                  {p.inventors && p.inventors.length > 0 && (
                    <div style={{fontSize:11,color:c.muted,marginBottom:6}}>👤 {p.inventors.slice(0,4).join(" / ")}{p.inventors.length>4?" 他"+(p.inventors.length-4)+"名":""}</div>
                  )}

                  {/* EPO要約 */}
                  {p.abstract_epo && (
                    <div style={{fontSize:11,color:c.muted,lineHeight:1.7,padding:"6px 10px",background:"#0a1e0a",borderRadius:5,borderLeft:"3px solid "+c.amber,marginBottom:8}}>
                      <div style={{fontSize:10,color:c.amber,fontWeight:600,marginBottom:3}}>EPO要約</div>
                      {p.abstract_epo.slice(0,200)}{p.abstract_epo.length>200&&"..."}
                    </div>
                  )}

                  {/* AI解説 */}
                  {hasSummary && (
                    <div style={{fontSize:12,color:c.text,lineHeight:1.8,padding:"8px 12px",background:c.bg2,borderRadius:6,borderLeft:"3px solid #e879f9",marginBottom:8}}>
                      <div style={{fontSize:10,color:"#e879f9",fontWeight:600,marginBottom:3}}>AI解説</div>
                      {p.summary_ja}
                    </div>
                  )}

                  {/* 独立請求項（DBから・折りたたみ） */}
                  {hasClaims && (
                    <details style={{marginBottom:8}}>
                      <summary style={{fontSize:11,color:c.purple,cursor:"pointer",padding:"4px 0"}}>独立請求項（DBから）</summary>
                      <div style={{fontSize:11,color:c.text,lineHeight:1.75,padding:"8px 10px",background:"#0d0820",borderRadius:5,borderLeft:"2px solid "+c.purple,marginTop:6}}>
                        {p.claims_independent}
                      </div>
                    </details>
                  )}

                  {/* 発明の詳細説明（DBから・折りたたみ） */}
                  {hasDesc && (
                    <details style={{marginBottom:8}}>
                      <summary style={{fontSize:11,color:c.cyan,cursor:"pointer",padding:"4px 0"}}>発明の詳細説明（DBから）</summary>
                      <div style={{fontSize:11,color:c.muted,lineHeight:1.7,padding:"8px 10px",background:c.bg2,borderRadius:5,marginTop:6,maxHeight:160,overflowY:"auto",border:"1px solid "+c.border}}>
                        {p.description_text.slice(0,2000)}{p.description_text.length>2000&&" ...（以下省略）"}
                      </div>
                    </details>
                  )}

                  {/* 詳細分析結果（DBから） */}
                  {hasDetail && (
                    <details style={{marginBottom:8}}>
                      <summary style={{fontSize:11,color:c.green,cursor:"pointer",padding:"4px 0"}}>詳細分析結果（DBから）</summary>
                      <div style={{padding:"10px",background:c.bg2,borderRadius:6,marginTop:6}}>
                        {[
                          {label:"【技術的課題】",   value:p.problem,      color:c.cyan},
                          {label:"【技術の仕組み】",  value:p.mechanism,    color:c.amber},
                          {label:"【革新性・新規性】", value:p.novelty_text, color:c.green},
                          {label:"【請求項の保護範囲】",value:p.protection,  color:c.purple},
                          {label:"【応用分野】",      value:p.applications, color:"#2dd4bf"},
                          {label:"【企業戦略】",      value:p.strategy,     color:"#f97316"},
                          {label:"【2050年シナリオ】", value:p.future2050,   color:"#e879f9"},
                        ].filter(item => item.value).map((item, idx) => (
                          <div key={idx} style={{marginBottom:8}}>
                            <div style={{fontSize:10,fontWeight:700,color:item.color,marginBottom:3}}>{item.label}</div>
                            <div style={{fontSize:11,color:c.text,lineHeight:1.7,padding:"5px 8px",background:c.bg1,borderRadius:4,borderLeft:"2px solid "+item.color}}>{item.value}</div>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  {/* 詳細分析ボタン */}
                  <button onClick={() => setDetailPatent(isDetail ? null : p)}
                    style={{fontSize:11,padding:"4px 12px",borderRadius:5,border:"1px solid "+(isDetail?c.purple:c.border),background:isDetail?"#0d0820":"transparent",color:isDetail?c.purple:c.muted,cursor:"pointer",marginTop:4}}>
                    {isDetail ? "▼ 新規取得・分析を閉じる" : hasClaims||hasDetail ? "🔬 再取得・再分析する" : "🔬 請求項取得 + Claude詳細分析"}
                  </button>
                </div>
              </div>
              {isDetail && <PatentDetailInline patent={p} fetchDescription={fetchDescription} fetchClaims={fetchClaims} claudePost={claudePost} sbPost={sbPost} sbUpsert={sbUpsert} supabaseUrl={supabaseUrl} supabaseKey={supabaseKey} c={c}/>}
            </div>
          );
        })}

        {totalPages > 1 && (
          <div style={{display:"flex",justifyContent:"center",gap:8,marginTop:16}}>
            <button onClick={() => doSearch(page-1)} disabled={page===0||loading} style={{padding:"6px 14px",borderRadius:6,border:"1px solid "+c.border,background:"transparent",color:page===0?c.muted:c.text,cursor:page===0?"not-allowed":"pointer"}}>← 前</button>
            <span style={{padding:"6px 14px",fontSize:12,color:c.muted}}>{page+1} / {totalPages}</span>
            <button onClick={() => doSearch(page+1)} disabled={page>=totalPages-1||loading} style={{padding:"6px 14px",borderRadius:6,border:"1px solid "+c.border,background:"transparent",color:page>=totalPages-1?c.muted:c.text,cursor:page>=totalPages-1?"not-allowed":"pointer"}}>次 →</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ━━━ 個別特許 詳細分析（インライン展開） ━━━━━━━━━━━━━━━━━━━━━ */
function PatentDetailInline({ patent, fetchDescription, fetchClaims, claudePost, sbPost, sbUpsert, supabaseUrl, supabaseKey, c }) {
  const [fetchPhase,    setFetchPhase]    = useState("idle");
  const [description,   setDescription]   = useState("");
  const [claimsData,    setClaimsData]    = useState({ allClaims:"", independentClaims:"" });
  const [showAll,       setShowAll]       = useState(false);
  const [fetchNote,     setFetchNote]     = useState("");
  const [errMsg,        setErrMsg]        = useState("");

  // ★ DBに保存済みの詳細分析を初期値としてセット
  const dbAnalysis = (patent.problem || patent.mechanism) ? {
    titleJa:         patent.title_ja       || "",
    problem:         patent.problem        || "",
    mechanism:       patent.mechanism      || "",
    novelty:         patent.novelty_text   || "",
    protection:      patent.protection     || "",
    applications:    patent.applications   || "",
    strategy:        patent.strategy       || "",
    future2050:      patent.future2050     || "",
    scoreNovelty:    patent.score_novelty    || 0,
    scoreImpact:     patent.score_impact     || 0,
    scoreCommercial: patent.score_commercial || 0,
  } : null;

  const [analysis,      setAnalysis]      = useState(dbAnalysis);
  const [analysisPhase, setAnalysisPhase] = useState(dbAnalysis ? "done" : "idle");

  const patentObj = { ...patent, docNum:patent.patent_number?.replace(/^[A-Z]+/,"").replace(/[A-Z]+\d*$/,""), kind:patent.patent_number?.match(/[A-Z]\d*$/)?.[0]||"" };

  const doFetch = async () => {
    setFetchPhase("loading"); setErrMsg(""); setFetchNote("");
    const [dR, cR] = await Promise.allSettled([fetchDescription(patentObj), fetchClaims(patentObj)]);
    const notes = [];
    const descText  = dR.status==="fulfilled" ? dR.value.text  : null;
    const claimsVal = cR.status==="fulfilled" ? cR.value       : null;
    if (descText)  { setDescription(descText);  notes.push("説明文: "+dR.value.format+"/"+dR.value.id); }
    else notes.push("説明文失敗: "+dR.reason?.message);
    if (claimsVal) { setClaimsData(claimsVal);  notes.push("請求項: "+cR.value.format+"/"+cR.value.id); }
    else notes.push("請求項失敗: "+cR.reason?.message);
    setFetchNote(notes.join(" / "));
    if (!descText && !claimsVal) {
      setErrMsg("説明文・請求項ともに取得できませんでした。EPO要約のみで分析します。");
      setFetchPhase("error");
    } else {
      setFetchPhase("done");
      // ★ DBに請求項・説明文を保存
      const patch = {};
      if (claimsVal?.independentClaims) patch.claims_independent = claimsVal.independentClaims;
      if (descText) patch.description_text = descText.slice(0, 30000);
      if (Object.keys(patch).length > 0 && supabaseUrl && supabaseKey) {
        fetch(
          supabaseUrl + "/rest/v1/patents?patent_number=eq." + encodeURIComponent(patent.patent_number),
          {
            method: "PATCH",
            headers: {
              "apikey": supabaseKey,
              "Authorization": "Bearer " + supabaseKey,
              "Content-Type": "application/json",
              "Prefer": "return=minimal",
            },
            body: JSON.stringify(patch),
          }
        ).catch(e => console.warn("claims/desc DB save failed:", e));
      }
    }
  };

  const doAnalyze = async () => {
    setAnalysisPhase("loading"); setErrMsg("");
    try {
      const prompt = "Senior patent analyst. Analyze in Japanese. Be concise.\n\n"
        + "Patent: "+patent.patent_number+" ["+patent.country+"]\n"
        + "Title: "+patent.title_en+"\n"
        + "Date: "+patent.publication_date+"\n"
        + "Inventors: "+(patent.inventors||[]).join(", ")+"\n\n"
        + "Abstract:\n"+(patent.abstract_epo||"N/A")+"\n\n"
        + "Independent Claims:\n"+(claimsData.independentClaims||"N/A")+"\n\n"
        + (claimsData.allClaims ? "All Claims:\n"+claimsData.allClaims.slice(0,1500)+"\n\n" : "")
        + (description ? "Description:\n"+description.slice(0,1500)+"\n\n" : "")
        + "Reply ONLY in this exact format (each field: 2-3 sentences, no truncation):\n"
        + "TITLE_JA:日本語タイトル\n"
        + "PROBLEM:技術的課題（2-3文）\n"
        + "MECHANISM:技術の仕組み（2-3文）\n"
        + "NOVELTY:革新性・新規性（2-3文）\n"
        + "PROTECTION:請求項の保護範囲（2-3文）\n"
        + "APPLICATIONS:応用分野（2-3文）\n"
        + "STRATEGY:企業戦略上の意義（2-3文）\n"
        + "FUTURE2050:2050年へのインパクト（2-3文）\n"
        + "SCORE_NOVELTY:革新性スコア（1-10整数のみ）\n"
        + "SCORE_IMPACT:社会的インパクトスコア（1-10整数のみ）\n"
        + "SCORE_COMMERCIAL:商業的価値スコア（1-10整数のみ）";
      const text = await claudePost(prompt, 3000);
      const getV = p => { const l = text.split("\n").find(l=>l.startsWith(p)); return l ? l.slice(p.length).trim() : ""; };
      const r = { titleJa:getV("TITLE_JA:"), problem:getV("PROBLEM:"), mechanism:getV("MECHANISM:"), novelty:getV("NOVELTY:"), protection:getV("PROTECTION:"), applications:getV("APPLICATIONS:"), strategy:getV("STRATEGY:"), future2050:getV("FUTURE2050:"), scoreNovelty:parseInt(getV("SCORE_NOVELTY:")||"0",10), scoreImpact:parseInt(getV("SCORE_IMPACT:")||"0",10), scoreCommercial:parseInt(getV("SCORE_COMMERCIAL:")||"0",10) };
      setAnalysis(r); setAnalysisPhase("done");
      // DBに保存
      await sbUpsert("ai_detail_analyses", [{ patent_number:patent.patent_number, problem:r.problem, mechanism:r.mechanism, novelty:r.novelty, protection:r.protection, applications:r.applications, strategy:r.strategy, future2050:r.future2050, score_novelty:r.scoreNovelty, score_impact:r.scoreImpact, score_commercial:r.scoreCommercial, analyzed_at:new Date().toISOString() }], "patent_number");
      // title_ja update is handled by SummariesTab
    } catch(e) { setErrMsg("AI分析エラー: "+e.message); setAnalysisPhase("error"); }
  };

  const SB = ({ label, score, color }) => (
    <div style={{marginBottom:8}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:11,color:c.muted}}>{label}</span><span style={{fontSize:12,fontWeight:700,color}}>{score}/10</span></div>
      <div style={{height:4,background:c.bg2,borderRadius:2,overflow:"hidden"}}><div style={{height:"100%",width:(score*10)+"%",background:color,borderRadius:2,transition:"width .5s"}}/></div>
    </div>
  );
  const Sec = ({ title, content, color }) => content ? (
    <div style={{marginBottom:10}}><div style={{fontSize:11,fontWeight:700,color,marginBottom:4}}>{title}</div><div style={{fontSize:11,color:c.text,lineHeight:1.75,padding:"6px 10px",background:c.bg2,borderRadius:5,borderLeft:"2px solid "+color}}>{content}</div></div>
  ) : null;

  return (
    <div style={{marginTop:12,paddingTop:12,borderTop:"1px solid "+c.border}}>
      {claimsData.independentClaims && (
        <div style={{marginBottom:10}}>
          <div style={{fontSize:11,fontWeight:700,color:c.purple,marginBottom:4}}>独立請求項</div>
          <div style={{fontSize:11,color:c.text,lineHeight:1.7,padding:"8px 10px",background:"#0d0820",borderRadius:5,borderLeft:"2px solid "+c.purple}}>{claimsData.independentClaims}</div>
          {claimsData.allClaims && claimsData.allClaims !== claimsData.independentClaims && (
            <div style={{marginTop:6}}>
              <button onClick={() => setShowAll(!showAll)} style={{fontSize:10,color:c.muted,background:"transparent",border:"1px solid "+c.border,borderRadius:4,padding:"2px 8px",cursor:"pointer"}}>{showAll?"▼ 全請求項を閉じる":"▶ 全請求項を表示"}</button>
              {showAll && <div style={{marginTop:6,fontSize:11,color:c.muted,lineHeight:1.7,padding:"8px 10px",background:c.bg2,borderRadius:5,maxHeight:160,overflowY:"auto"}}>{claimsData.allClaims}</div>}
            </div>
          )}
        </div>
      )}
      {description && (
        <div style={{marginBottom:10}}>
          <div style={{fontSize:11,fontWeight:700,color:c.cyan,marginBottom:4}}>発明の詳細説明（抜粋）</div>
          <div style={{fontSize:11,color:c.muted,lineHeight:1.7,padding:"8px 10px",background:c.bg2,borderRadius:5,maxHeight:120,overflowY:"auto",border:"1px solid "+c.border}}>{description.slice(0,1500)}{description.length>1500&&" ...（以下省略）"}</div>
        </div>
      )}
      {fetchNote && <div style={{fontSize:10,color:c.muted,marginBottom:8,padding:"4px 8px",background:c.bg2,borderRadius:4}}>{fetchNote}</div>}
      {errMsg && <div style={{fontSize:11,color:c.amber,padding:"6px 10px",background:"#1a1000",borderRadius:5,marginBottom:8}}>{errMsg}</div>}
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
        {fetchPhase === "idle" && (
          <button onClick={doFetch} style={{padding:"6px 14px",borderRadius:6,border:"none",background:c.amber,color:"#000",fontWeight:600,fontSize:12,cursor:"pointer"}}>請求項・説明文を取得する</button>
        )}
        {fetchPhase === "loading" && <span style={{fontSize:12,color:c.amber}}>● epodoc/docdb形式を試行中...</span>}
        {(analysisPhase === "idle" || analysisPhase === "done") && (
          <button onClick={doAnalyze} style={{padding:"6px 16px",borderRadius:6,border:"none",background:analysisPhase==="done"?"#1a3550":c.purple,color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer"}}>
            {analysisPhase === "done" ? "🔄 詳細分析を再実行する" : "Claude AI で詳細分析する"}
          </button>
        )}
        {analysisPhase === "loading" && <span style={{fontSize:12,color:c.purple}}>● Claude AIが詳細分析中...</span>}
        {analysisPhase === "done" && <span style={{fontSize:10,color:c.green}}>✓ DB保存済み</span>}
      </div>
      {analysis && (
        <div style={{padding:"12px",background:c.bg2,borderRadius:8}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8,flexWrap:"wrap"}}>
            {dbAnalysis && analysisPhase !== "loading" && (
              <div style={{fontSize:10,color:c.green,padding:"3px 8px",background:"#0a1e0a",borderRadius:4}}>
                ✓ DB保存済みの詳細分析を表示中
              </div>
            )}
            <button
              onClick={() => printToPDF(
                patent.patent_number + "_詳細分析",
                generateDetailHTML(patent, analysis)
              )}
              style={{marginLeft:"auto",padding:"4px 12px",borderRadius:5,border:"1px solid #16a34a",background:"transparent",color:"#16a34a",fontSize:11,fontWeight:600,cursor:"pointer"}}>
              📄 PDFで出力する
            </button>
          </div>
          <div style={{marginBottom:10}}><SB label="革新性" score={analysis.scoreNovelty} color={c.cyan}/><SB label="社会的インパクト" score={analysis.scoreImpact} color={c.green}/><SB label="商業的価値" score={analysis.scoreCommercial} color={c.amber}/></div>
          <Sec title="【技術的課題】" content={analysis.problem} color={c.cyan}/>
          <Sec title="【技術の仕組み】" content={analysis.mechanism} color={c.amber}/>
          <Sec title="【革新性・新規性】" content={analysis.novelty} color={c.green}/>
          <Sec title="【請求項が保護する範囲】" content={analysis.protection} color={c.purple}/>
          <Sec title="【応用分野】" content={analysis.applications} color="#2dd4bf"/>
          <Sec title="【企業戦略上の意義】" content={analysis.strategy} color="#f97316"/>
          <Sec title="【2050年へのインパクト】" content={analysis.future2050} color="#e879f9"/>
        </div>
      )}
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   🤖 AI分析タブ（ポートフォリオ分析 — DBデータを使用）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function AnalyzeTab({ sbGet, supabaseUrl, supabaseKey, companies, c, card }) {
  const [allAnalyses, setAllAnalyses] = useState([]);   // 特許分析(portfolio_analyses)
  const [allPaperAnalyses, setAllPaperAnalyses] = useState([]); // 論文分析(paper_analyses)
  const [selRow,      setSelRow]      = useState(null);  // 選択中の分析レコード
  const [selKind,     setSelKind]     = useState(null);  // "patent" | "paper"
  const [analysis,    setAnalysis]    = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [err,         setErr]         = useState("");
  const [showList,    setShowList]    = useState(true);
  const [listTab,     setListTab]     = useState("patent");  // 左パネルの表示タブ

  useEffect(() => { loadAllAnalyses(); loadAllPaperAnalyses(); }, []);

  const loadAllAnalyses = async () => {
    try {
      const rows = await sbGet(
        "portfolio_analyses?select=company_id,company_name,date_from,date_to,total_patents,analyzed_at&order=analyzed_at.desc&limit=200"
      );
      setAllAnalyses(rows || []);
    } catch(e) {}
  };

  const loadAllPaperAnalyses = async () => {
    try {
      const res = await fetch(
        (supabaseUrl||"") + "/rest/v1/paper_analyses?select=id,filter_desc,total_papers,analyzed_at&order=analyzed_at.desc&limit=200",
        { headers: { apikey: supabaseKey, Authorization: "Bearer "+supabaseKey, "Accept-Profile": "openalex" } }
      );
      const rows = await res.json();
      setAllPaperAnalyses(Array.isArray(rows) ? rows : []);
    } catch(e) {}
  };

  const selectRow = async (row) => {
    setSelRow(row); setSelKind("patent"); setLoading(true); setErr(""); setAnalysis(null);
    try {
      const rows = await sbGet(
        "portfolio_analyses?company_id=eq."+row.company_id
        +"&date_from=eq."+row.date_from+"&date_to=eq."+row.date_to
        +"&select=*&order=analyzed_at.desc&limit=1"
      );
      if (rows && rows.length > 0) {
        const r = rows[0];
        const cats   = typeof r.categories === "string" ? JSON.parse(r.categories) : (r.categories || []);
        const trends = typeof r.trends     === "string" ? JSON.parse(r.trends)     : (r.trends     || []);
        setAnalysis({ kind:"patent", categories:cats, trends, impact2050:r.impact2050, strategic:r.strategic, topPatent:r.top_patent, analyzedAt:r.analyzed_at, totalPatents:r.total_patents });
      } else {
        setErr("分析データを取得できませんでした。");
      }
    } catch(e) { setErr("取得エラー: "+e.message); }
    setLoading(false);
  };

  const selectPaperRow = async (row) => {
    setSelRow(row); setSelKind("paper"); setLoading(true); setErr(""); setAnalysis(null);
    try {
      const res = await fetch(
        (supabaseUrl||"") + "/rest/v1/paper_analyses?id=eq."+row.id+"&select=*",
        { headers: { apikey: supabaseKey, Authorization: "Bearer "+supabaseKey, "Accept-Profile": "openalex" } }
      );
      const rows = await res.json();
      if (rows && rows.length > 0) {
        const r = rows[0];
        const cats   = typeof r.categories === "string" ? JSON.parse(r.categories) : (r.categories || []);
        const trends = typeof r.trends     === "string" ? JSON.parse(r.trends)     : (r.trends     || []);
        setAnalysis({ kind:"paper", categories:cats, trends, impact2050:r.impact2040, strategic:r.strategic, topPatent:r.notable, analyzedAt:r.analyzed_at, totalPatents:r.total_papers, filterDesc:r.filter_desc });
      } else {
        setErr("分析データを取得できませんでした。");
      }
    } catch(e) { setErr("取得エラー: "+e.message); }
    setLoading(false);
  };

  const deletePaperAnalysis = async (row, e) => {
    e.stopPropagation();
    if (!window.confirm("この論文分析データを削除しますか？")) return;
    try {
      await fetch((supabaseUrl||"") + "/rest/v1/paper_analyses?id=eq."+row.id,
        { method:"DELETE", headers:{ apikey: supabaseKey, Authorization:"Bearer "+supabaseKey, "Accept-Profile":"openalex" } });
      setAllPaperAnalyses(prev => prev.filter(x => x.id !== row.id));
      if (selKind === "paper" && selRow?.id === row.id) { setSelRow(null); setAnalysis(null); }
    } catch(err) { alert("削除失敗: "+err.message); }
  };

  const co = (selKind === "patent" && selRow) ? companies.find(c => c.id === selRow.company_id) : null;
  const totalCount = allAnalyses.length + allPaperAnalyses.length;

  return (
    <div style={{display:"flex",flex:1,overflow:"hidden"}}>

      {/* 左：一覧パネル(幅220: 検索・閲覧と統一) */}
      <div style={{width:220,borderRight:"1px solid "+c.border,background:c.bg1,display:"flex",flexDirection:"column",flexShrink:0}}>
        <div style={{padding:"10px 10px 8px",borderBottom:"1px solid "+c.border}}>
          <div style={{fontSize:11,fontWeight:700,color:c.purple,marginBottom:8}}>📋 分析一覧</div>
          <div style={{display:"flex",gap:4,marginBottom:6}}>
            <button onClick={() => setListTab("patent")}
              style={{flex:1,padding:"6px 8px",borderRadius:5,border:"1px solid "+(listTab==="patent"?c.cyan:c.border),background:listTab==="patent"?"#0c2d42":"transparent",color:listTab==="patent"?c.cyan:c.muted,fontSize:11,fontWeight:700,cursor:"pointer"}}>
              📋 特許
            </button>
            <button onClick={() => setListTab("paper")}
              style={{flex:1,padding:"6px 8px",borderRadius:5,border:"1px solid "+(listTab==="paper"?"#34d399":c.border),background:listTab==="paper"?"#052e2b":"transparent",color:listTab==="paper"?"#34d399":c.muted,fontSize:11,fontWeight:700,cursor:"pointer"}}>
              📄 論文
            </button>
          </div>
          <div style={{fontSize:10,color:c.muted}}>{listTab==="patent" ? allAnalyses.length : allPaperAnalyses.length}件</div>
        </div>
        <div style={{flex:1,overflowY:"auto",padding:"8px"}}>
          {totalCount === 0 && (
            <div style={{textAlign:"center",paddingTop:40,color:c.muted}}>
              <div style={{fontSize:20,marginBottom:8}}>📊</div>
              <div style={{fontSize:12,lineHeight:1.8}}>まだ分析データがありません。<br/>「検索・閲覧」タブの<br/>「AI分析」から<br/>分析を実施してください。</div>
            </div>
          )}
          {totalCount > 0 && ((listTab === "patent" && allAnalyses.length === 0) || (listTab === "paper" && allPaperAnalyses.length === 0)) && (
            <div style={{textAlign:"center",paddingTop:40,color:c.muted}}>
              <div style={{fontSize:20,marginBottom:8}}>{listTab === "patent" ? "📋" : "📄"}</div>
              <div style={{fontSize:12,lineHeight:1.8}}>{listTab === "patent" ? "特許分析データなし" : "論文分析データなし"}<br/><span style={{fontSize:10}}>別のタブを確認してください</span></div>
            </div>
          )}

          {/* 特許分析 */}
          {listTab === "patent" && allAnalyses.length > 0 && (
            <div style={{fontSize:10,fontWeight:700,color:c.cyan,margin:"4px 4px 6px",letterSpacing:".05em"}}>特許分析結果</div>
          )}
          {listTab === "patent" && allAnalyses.map((row, i) => {
            const rowCo   = companies.find(c => c.id === row.company_id);
            const isActive = selKind==="patent" && selRow?.company_id === row.company_id && selRow?.date_from === row.date_from && selRow?.date_to === row.date_to;
            return (
              <div key={"pat"+i}
                style={{padding:"10px 12px",borderRadius:7,marginBottom:4,background:isActive?"#0c2d42":"transparent",border:"1px solid "+(isActive?c.cyan:c.border),transition:"background .1s"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,cursor:"pointer"}} onClick={() => selectRow(row)}>
                  <span style={{fontSize:13}}>{rowCo?.flag || "🔍"}</span>
                  <span style={{fontSize:12,fontWeight:600,color:isActive?c.cyan:c.text,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",cursor:"pointer"}}>
                    {row.company_name}
                  </span>
                  {isActive && <span style={{fontSize:9,color:c.cyan,padding:"1px 5px",borderRadius:3,border:"1px solid "+c.cyan,flexShrink:0}}>表示中</span>}
                </div>
                <div style={{display:"flex",alignItems:"center",gap:6,marginTop:4}}>
                  <div style={{flex:1,cursor:"pointer"}} onClick={() => selectRow(row)}>
                    <div style={{fontSize:10,color:c.muted}}>{row.date_from} 〜 {row.date_to}</div>
                    <div style={{display:"flex",justifyContent:"space-between",marginTop:2}}>
                      <span style={{fontSize:10,color:c.muted}}>{row.total_patents}件</span>
                      <span style={{fontSize:10,color:c.muted}}>{new Date(row.analyzed_at).toLocaleDateString("ja-JP")}</span>
                    </div>
                  </div>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!window.confirm("「"+row.company_name+"」の分析データを削除しますか？")) return;
                      try {
                        await fetch(
                          (typeof supabaseUrl !== "undefined" ? supabaseUrl : "") +
                          "/rest/v1/portfolio_analyses?company_id=eq."+encodeURIComponent(row.company_id)+
                          "&date_from=eq."+row.date_from+"&date_to=eq."+row.date_to,
                          { method:"DELETE", headers:{"apikey": (typeof supabaseKey !== "undefined" ? supabaseKey : ""), "Authorization":"Bearer "+(typeof supabaseKey !== "undefined" ? supabaseKey : "")} }
                        );
                        setAllAnalyses(prev => prev.filter((_, idx) => idx !== i));
                        if (selKind==="patent" && isActive) { setSelRow(null); setAnalysis(null); }
                      } catch(err) { alert("削除失敗: "+err.message); }
                    }}
                    style={{padding:"3px 8px",borderRadius:4,border:"1px solid #dc2626",background:"transparent",color:"#dc2626",fontSize:10,cursor:"pointer",flexShrink:0}}>
                    🗑
                  </button>
                </div>
              </div>
            );
          })}

          {/* 論文分析 */}
          {listTab === "paper" && allPaperAnalyses.length > 0 && (
            <div style={{fontSize:10,fontWeight:700,color:"#34d399",margin:"4px 4px 6px",letterSpacing:".05em"}}>論文分析結果</div>
          )}
          {listTab === "paper" && allPaperAnalyses.map((row, i) => {
            const isActive = selKind==="paper" && selRow?.id === row.id;
            return (
              <div key={"pap"+i}
                style={{padding:"10px 12px",borderRadius:7,marginBottom:4,background:isActive?"#052e2b":"transparent",border:"1px solid "+(isActive?"#34d399":c.border),transition:"background .1s"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,cursor:"pointer"}} onClick={() => selectPaperRow(row)}>
                  <span style={{fontSize:13}}>📄</span>
                  <span style={{fontSize:12,fontWeight:600,color:isActive?"#34d399":c.text,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",cursor:"pointer"}}>
                    {row.filter_desc || "フィルターなし"}
                  </span>
                  {isActive && <span style={{fontSize:9,color:"#34d399",padding:"1px 5px",borderRadius:3,border:"1px solid #34d399",flexShrink:0}}>表示中</span>}
                </div>
                <div style={{display:"flex",alignItems:"center",gap:6,marginTop:4}}>
                  <div style={{flex:1,cursor:"pointer"}} onClick={() => selectPaperRow(row)}>
                    <div style={{display:"flex",justifyContent:"space-between",marginTop:2}}>
                      <span style={{fontSize:10,color:c.muted}}>{row.total_papers}件</span>
                      <span style={{fontSize:10,color:c.muted}}>{new Date(row.analyzed_at).toLocaleDateString("ja-JP")}</span>
                    </div>
                  </div>
                  <button onClick={(e) => deletePaperAnalysis(row, e)}
                    style={{padding:"3px 8px",borderRadius:4,border:"1px solid #dc2626",background:"transparent",color:"#dc2626",fontSize:10,cursor:"pointer",flexShrink:0}}>
                    🗑
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 右：分析結果表示 */}
      <div style={{flex:1,overflowY:"auto",padding:16}}>
        {!selRow && (
          <div style={{textAlign:"center",paddingTop:80,color:c.muted}}>
            <div style={{fontSize:32,marginBottom:12}}>📊</div>
            <div style={{fontSize:15,fontWeight:600,color:c.text,marginBottom:8}}>AI分析結果ビューア</div>
            <div style={{fontSize:13,lineHeight:1.9}}>
              左の一覧から分析結果を選択してください<br/>
              <span style={{fontSize:11,color:c.muted}}>特許・論文どちらの分析も表示できます</span>
            </div>
          </div>
        )}

        {loading && (
          <div style={{textAlign:"center",paddingTop:60,color:c.muted}}>
            <div style={{fontSize:24,marginBottom:10}}>⏳</div>
            <div style={{fontSize:13}}>DBから分析データを読み込み中...</div>
          </div>
        )}

        {err && <div style={{padding:"8px 12px",background:"#1a1000",borderRadius:6,fontSize:11,color:c.amber,marginBottom:12}}>{err}</div>}

        {analysis && !loading && (
          <>
            {/* ヘッダー */}
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16,flexWrap:"wrap"}}>
              <div>
                {analysis.kind === "patent" ? (
                  <>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                      <span style={{fontSize:16}}>{co?.flag || "🔍"}</span>
                      <span style={{fontSize:16,fontWeight:700,color:c.cyan}}>{selRow.company_name}</span>
                      <span style={{fontSize:10,padding:"2px 8px",borderRadius:4,background:"#0c2d42",color:c.cyan,border:"1px solid "+c.cyan}}>特許</span>
                    </div>
                    <div style={{fontSize:11,color:c.muted}}>
                      {selRow.date_from} 〜 {selRow.date_to} ／ 対象: {analysis.totalPatents}件 ／ 分析日時: {new Date(analysis.analyzedAt).toLocaleString("ja-JP")}
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                      <span style={{fontSize:16}}>📄</span>
                      <span style={{fontSize:16,fontWeight:700,color:"#34d399"}}>{analysis.filterDesc}</span>
                      <span style={{fontSize:10,padding:"2px 8px",borderRadius:4,background:"#052e2b",color:"#34d399",border:"1px solid #34d399"}}>論文</span>
                    </div>
                    <div style={{fontSize:11,color:c.muted}}>
                      対象: {analysis.totalPatents}件 ／ 分析日時: {new Date(analysis.analyzedAt).toLocaleString("ja-JP")}
                    </div>
                  </>
                )}
              </div>
              {analysis.kind === "patent" && (
                <button
                  onClick={() => printToPDF(
                    selRow.company_name + "_AI分析レポート",
                    generatePortfolioHTML(co || {name: selRow.company_name}, analysis, {total_patents: analysis.totalPatents, analyzed_at: analysis.analyzedAt})
                  )}
                  style={{marginLeft:"auto",padding:"6px 16px",borderRadius:6,border:"1px solid #16a34a",background:"transparent",color:"#16a34a",fontSize:12,fontWeight:600,cursor:"pointer"}}>
                  📄 PDFで出力する
                </button>
              )}
            </div>

            {/* 分析結果グリッド(特許・論文 共通フォーマット) */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
              <div style={card}>
                <div style={{fontSize:12,fontWeight:700,color:c.cyan,marginBottom:12}}>
                  {analysis.kind === "patent" ? "技術カテゴリー分類" : "研究テーマ分類"}
                </div>
                {analysis.categories.map((cat,i) => (
                  <div key={i} style={{marginBottom:12}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                      <span style={{fontSize:13,fontWeight:600,color:c.text}}>{cat.name}</span>
                      <span style={{fontSize:13,color:c.cyan,fontWeight:700}}>{cat.pct}%</span>
                    </div>
                    <div style={{height:6,background:c.bg2,borderRadius:3,overflow:"hidden",marginBottom:3}}>
                      <div style={{height:"100%",width:cat.pct+"%",background:"linear-gradient(90deg,"+c.cyan+",#7dd3fc)",borderRadius:3}}/>
                    </div>
                    <div style={{fontSize:11,color:c.muted}}>{cat.desc}</div>
                  </div>
                ))}
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:12}}>
                <div style={card}>
                  <div style={{fontSize:12,fontWeight:700,color:c.amber,marginBottom:10}}>
                    {analysis.kind === "patent" ? "主要イノベーション動向" : "主要研究トレンド"}
                  </div>
                  {analysis.trends.map((t,i) => (
                    <div key={i} style={{marginBottom:10,paddingLeft:10,borderLeft:"2px solid "+c.amber}}>
                      <div style={{fontSize:12,fontWeight:600,color:c.text,marginBottom:3}}>{t.title}</div>
                      <div style={{fontSize:11,color:c.muted,lineHeight:1.6}}>{t.body}</div>
                    </div>
                  ))}
                </div>
                <div style={card}>
                  <div style={{fontSize:12,fontWeight:700,color:c.green,marginBottom:8}}>
                    {analysis.kind === "patent" ? "2050年 社会変革シナリオ" : "2040年 社会実装シナリオ"}
                  </div>
                  <div style={{fontSize:12,color:c.text,lineHeight:1.75}}>{analysis.impact2050}</div>
                </div>
                <div style={card}>
                  <div style={{fontSize:12,fontWeight:700,color:c.purple,marginBottom:8}}>
                    {analysis.kind === "patent" ? "戦略的示唆" : "産業への戦略的示唆"}
                  </div>
                  <div style={{fontSize:12,color:c.text,lineHeight:1.75}}>{analysis.strategic}</div>
                </div>
                {analysis.topPatent && (
                  <div style={{...card,borderColor:c.cyan}}>
                    <div style={{fontSize:11,color:c.cyan,marginBottom:6}}>
                      {analysis.kind === "patent" ? "★ 最注目特許" : "★ 最注目論文"}
                    </div>
                    <div style={{fontSize:12,color:c.text,lineHeight:1.65}}>{analysis.topPatent}</div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}


/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ⚙️ 企業管理タブ
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function ManageTab({ supabaseUrl, supabaseKey, companies, onRefresh, c, card }) {
  const [list,        setList]        = useState([...companies]);
  const [loading,     setLoading]     = useState(false);
  const [msg,         setMsg]         = useState("");
  const [showForm,    setShowForm]    = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const [form,        setForm]        = useState({ id:"", name:"", legal:"", flag:"🏢", sector:"テクノロジー" });

  const SECTORS = ["テクノロジー","半導体","電機","電機・エンタメ","イメージング","自動車","産業","ヘルスケア","航空宇宙","宇宙","通信","エンタメ","美容","消費財","その他"];

  const authH = {
    "apikey": supabaseKey, "Authorization": "Bearer " + supabaseKey,
    "Content-Type": "application/json", "Prefer": "return=minimal",
  };

  // DBから最新の企業リストを読み込む
  const loadList = async () => {
    setLoading(true);
    try {
      const res = await fetch(supabaseUrl + "/rest/v1/companies?select=id,name,legal,flag,sector&order=name.asc", {
        headers: { "apikey": supabaseKey, "Authorization": "Bearer " + supabaseKey, "Accept": "application/json" }
      });
      if (res.ok) setList(await res.json());
    } catch(e) {}
    setLoading(false);
  };

  useEffect(() => { loadList(); }, []);

  // 企業を追加
  const doAdd = async () => {
    if (!form.id || !form.name || !form.legal) { setMsg("❌ ID・名前・EPO検索名はすべて必須です"); return; }
    if (list.find(c => c.id === form.id)) { setMsg("❌ そのIDは既に存在します"); return; }
    setLoading(true); setMsg("");
    try {
      const legalArray = form.legal.split(",").map(s=>s.trim()).filter(Boolean);
const res = await fetch(supabaseUrl+"/rest/v1/companies", {
        method: "POST", headers: authH, body:JSON.stringify([{ ...form, legal: legalArray }])
      });
      if (!res.ok) throw new Error(await res.text());
      setMsg("✅ 「" + form.name + "」を追加しました。");
      setForm({ id:"", name:"", legal:"", flag:"🏢", sector:"テクノロジー" });
      setShowForm(false);
      await loadList();
      setNeedsReload(true);
    } catch(e) { setMsg("❌ 追加失敗: " + e.message); }
    setLoading(false);
  };

  // 企業を削除（特許データは保持）
  const doDelete = async (co) => {
    if (!window.confirm(
      "「" + co.name + "」を企業リストから削除しますか？\n\n" +
      "※ 取得済みの特許・AI解説などのデータはDBに残ります。\n" +
      "　 再度追加すれば既存データを引き続き利用できます。"
    )) return;
    setLoading(true); setMsg("");
    try {
      const res = await fetch(
        supabaseUrl + "/rest/v1/companies?id=eq." + encodeURIComponent(co.id),
        { method: "DELETE", headers: { "apikey": supabaseKey, "Authorization": "Bearer " + supabaseKey } }
      );
      if (!res.ok) throw new Error(await res.text());
      setMsg("✅ 「" + co.name + "」を削除しました。特許データはDBに保持されています。");
      await loadList();
      setNeedsReload(true);
    } catch(e) { setMsg("❌ 削除失敗: " + e.message); }
    setLoading(false);
  };

  const inp = (placeholder, key, w="100%") => (
    <input value={form[key]} onChange={e => setForm(f => ({...f, [key]: e.target.value}))}
      placeholder={placeholder}
      style={{width:w,padding:"6px 10px",borderRadius:6,border:"1px solid "+c.border,background:c.bg2,color:c.text,fontSize:12,outline:"none",boxSizing:"border-box"}}/>
  );

  return (
    <div style={{flex:1,overflowY:"auto",padding:16}}>
      {/* ヘッダー */}
      <div style={{...card,marginBottom:16}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:8}}>
          <span style={{fontSize:14,fontWeight:700,color:c.purple}}>⚙️ 企業管理</span>
          <span style={{fontSize:11,color:c.muted}}>{list.length}社登録済み</span>
          <button onClick={() => setShowForm(!showForm)}
            style={{marginLeft:"auto",padding:"6px 16px",borderRadius:6,border:"none",background:showForm?"#1a3550":c.cyan,color:showForm?c.muted:"#000",fontWeight:700,fontSize:12,cursor:"pointer"}}>
            {showForm ? "✕ キャンセル" : "+ 企業を追加"}
          </button>
        </div>
        <div style={{fontSize:11,color:c.muted,lineHeight:1.8}}>
          ここで企業を追加・削除できます。削除しても既存の特許データはDBに残ります。
        </div>
        {needsReload && (
          <div style={{marginTop:10,padding:"8px 12px",background:"#1a1200",borderRadius:6,border:"1px solid "+c.amber,display:"flex",alignItems:"center",gap:12}}>
            <span style={{fontSize:11,color:c.amber}}>⚠️ 変更を両画面に反映するには再読み込みが必要です</span>
            <button onClick={() => window.location.reload()}
              style={{padding:"4px 14px",borderRadius:5,border:"none",background:c.amber,color:"#000",fontWeight:700,fontSize:11,cursor:"pointer",flexShrink:0}}>
              🔄 今すぐ再読み込み
            </button>
          </div>
        )}
      </div>

      {msg && (
        <div style={{padding:"8px 14px",borderRadius:7,marginBottom:14,fontSize:12,
          background:msg.startsWith("✅")?"#0a1e0a":"#1a1000",
          color:msg.startsWith("✅")?c.green:c.amber,
          border:"1px solid "+(msg.startsWith("✅")?"#14532d":"#3d2a00")}}>
          {msg}
        </div>
      )}

      {/* 追加フォーム */}
      {showForm && (
        <div style={{...card,marginBottom:16,borderColor:c.cyan}}>
          <div style={{fontSize:12,fontWeight:700,color:c.cyan,marginBottom:12}}>新しい企業を追加</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
            <div>
              <div style={{fontSize:11,color:c.muted,marginBottom:4}}>ID（英数字・ハイフンのみ）*</div>
              {inp("例: panasonic", "id")}
              <div style={{fontSize:10,color:c.muted,marginTop:3}}>一度設定したIDは変更できません</div>
            </div>
            <div>
              <div style={{fontSize:11,color:c.muted,marginBottom:4}}>表示名 *</div>
              {inp("例: パナソニック", "name")}
            </div>
            <div>
              <div style={{fontSize:11,color:c.muted,marginBottom:4}}>EPO検索名（出願人名）*</div>
             {inp("例: Panasonic, Panasonic Holdings", "legal")}
<div style={{fontSize:10,color:c.muted,marginTop:3}}>
  カンマ区切りで複数入力可（例: Samsung Electronics, Samsung Display）
</div>
            </div>
            <div>
              <div style={{fontSize:11,color:c.muted,marginBottom:4}}>国旗 emoji</div>
              {inp("🇯🇵", "flag")}
            </div>
            <div>
              <div style={{fontSize:11,color:c.muted,marginBottom:4}}>セクター</div>
              <select value={form.sector} onChange={e => setForm(f => ({...f, sector:e.target.value}))}
                style={{width:"100%",padding:"6px 10px",borderRadius:6,border:"1px solid "+c.border,background:c.bg2,color:c.text,fontSize:12,outline:"none"}}>
                {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <button onClick={doAdd} disabled={loading}
            style={{padding:"8px 24px",borderRadius:7,border:"none",background:loading?"#1a3550":c.green,color:loading?c.muted:"#000",fontWeight:700,fontSize:13,cursor:loading?"not-allowed":"pointer"}}>
            {loading ? "追加中..." : "✅ 追加する"}
          </button>
        </div>
      )}

      {/* 企業一覧 */}
      <div style={card}>
        <div style={{fontSize:11,color:c.muted,marginBottom:10}}>登録済み企業一覧（クリックで削除）</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(280px, 1fr))",gap:8}}>
          {list.map(co => (
            <div key={co.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderRadius:8,border:"1px solid "+c.border,background:c.bg2}}>
              <span style={{fontSize:18}}>{co.flag || "🏢"}</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12,fontWeight:600,color:c.text}}>{co.name}</div>
                <div style={{fontSize:10,color:c.muted}}>
  EPO: {Array.isArray(co.legal) ? co.legal.join(", ") : (co.legal||co.name)}
</div>
                <div style={{fontSize:10,color:c.muted}}>{co.sector}</div>
              </div>
              <button onClick={() => doDelete(co)} disabled={loading}
                style={{padding:"4px 8px",borderRadius:5,border:"1px solid #dc2626",background:"transparent",color:"#dc2626",fontSize:11,cursor:loading?"not-allowed":"pointer",flexShrink:0}}>
                🗑 削除
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   🏷️ キーワードランキングタブ
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

// 英語ストップワード（技術的に意味のない語を除外）
const STOP_WORDS = new Set([
  "a","an","the","and","or","of","in","for","to","with","on","at","by","from",
  "is","are","be","been","being","was","were","has","have","had","do","does","did",
  "will","would","could","should","may","might","can","that","this","these","those",
  "its","it","as","not","no","but","if","into","onto","via","per","use","used",
  "using","based","comprising","wherein","method","system","device","apparatus",
  "thereof","thereby","therefrom","thereto","wherein","whereby","herein",
  "one","two","three","first","second","third","each","plurality","least","more",
  "than","such","other","another","said","which","when","where","how","what",
  "includes","including","comprising","configured","adapted","associated","related",
  "provided","having","along","between","about","over","under","through","during",
  "after","before","also","further","according","without","within","outside",
]);

// テキストからキーワードを単純抽出（頻度ベース）
function extractKeywordsSimple(texts, topN = 50) {
  const freq = {};
  for (const text of texts) {
    if (!text) continue;
    // 英数字の単語を抽出（2文字以上、純粋な数字を除く）
    const words = text.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter(w => w.length >= 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));
    // 2-gram も追加
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (w) freq[w] = (freq[w] || 0) + 1;
      if (i < words.length - 1 && words[i+1]) {
        const bigram = w + " " + words[i+1];
        if (!STOP_WORDS.has(w) && !STOP_WORDS.has(words[i+1])) {
          freq[bigram] = (freq[bigram] || 0) + 1;
        }
      }
    }
  }
  return Object.entries(freq)
    .filter(([k, v]) => v >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([keyword, count]) => ({ keyword, count }));
}

function KeywordsTab({ sbGet, claudePost, companies, supabaseUrl, supabaseKey, c, card }) {
  const [dataSource,  setDataSource]  = useState("patent"); // patent | paper
  const [mode,        setMode]        = useState("overall"); // overall | company
  const [selCompany,  setSelCompany]  = useState(null);
  const [selYear,     setSelYear]     = useState("");        // "" = 全期間 | "2024" など
  const [method,      setMethod]      = useState("simple"); // simple | ai
  const [phase,       setPhase]       = useState("idle");
  const [keywords,    setKeywords]    = useState([]);
  const [totalPatents,setTotalPatents]= useState(0);
  const [err,         setErr]         = useState("");
  const [aiProgress,  setAiProgress]  = useState({ done:0, total:0 });

  // 年の選択肢（データ収集開始の2022年〜今年）
  const YEARS = [];
  for (let y = new Date().getFullYear(); y >= 2022; y--) YEARS.push(String(y));

  const maxCount = keywords.length > 0 ? keywords[0].count : 1;

  const doExtract = async () => {
    setPhase("loading"); setErr(""); setKeywords([]);
    try {
      const PAGE = 1000;
      let allData = [];
      let summaryMap = {};

      if (dataSource === "patent") {
        // ★ 特許モード（企業別・年別フィルター対応）
        let baseFilter = "";
        if (mode === "company" && selCompany) baseFilter += "company_id=eq."+selCompany.id+"&";
        if (selYear) baseFilter += "publication_date=gte."+selYear+"-01-01&publication_date=lte."+selYear+"-12-31&";
        let offset = 0;
        while (true) {
          const rows = await sbGet(
            "patents?"+baseFilter+"select=patent_number,title_en,abstract_epo,claims_independent,description_text"
            +"&limit="+PAGE+"&offset="+offset+"&order=publication_date.desc"
          );
          if (!rows || rows.length === 0) break;
          allData.push(...rows);
          if (rows.length < PAGE) break;
          offset += PAGE;
          await new Promise(r => setTimeout(r, 200));
        }

        // AI解説も全件ページネーション取得
        let sOffset = 0;
        while (true) {
          const rows = await sbGet(
            "ai_summaries?select=patent_number,summary_ja&limit="+PAGE+"&offset="+sOffset
          ).catch(() => []);
          if (!rows || rows.length === 0) break;
          const numSet = new Set(allData.map(p => p.patent_number));
          rows.filter(s => numSet.has(s.patent_number)).forEach(s => {
            summaryMap[s.patent_number] = s.summary_ja;
          });
          if (rows.length < PAGE) break;
          sOffset += PAGE;
          await new Promise(r => setTimeout(r, 200));
        }
      } else {
        // ★ 論文モード — papers_search（openalexスキーマ）から全件取得（企業別・年別フィルター対応）
        let paperFilter = "";
        if (mode === "company" && selCompany) paperFilter += "company_slug=eq."+selCompany.id+"&";
        if (selYear) paperFilter += "publication_year=eq."+selYear+"&";
        let offset = 0;
        while (true) {
          const res = await fetch(
            supabaseUrl+"/rest/v1/papers_search?"+paperFilter
            +"select=openalex_id,title,abstract_text,abstract_ja"
            +"&limit="+PAGE+"&offset="+offset,
            { headers: {
                "apikey": supabaseKey,
                "Authorization": "Bearer "+supabaseKey,
                "Accept-Profile": "openalex",
              } }
          );
          if (!res.ok) throw new Error("論文取得失敗: HTTP "+res.status);
          const rows = await res.json();
          if (!rows || rows.length === 0) break;
          allData.push(...rows);
          // 日本語要約は papers_search の abstract_ja をそのまま利用
          rows.forEach(p => { if (p.abstract_ja) summaryMap[p.openalex_id] = p.abstract_ja; });
          if (rows.length < PAGE) break;
          offset += PAGE;
          await new Promise(r => setTimeout(r, 200));
        }
      }

      if (!allData || allData.length === 0) {
        setErr(dataSource === "patent" ? "特許データがありません。" : "論文データがありません。");
        setPhase("idle"); return;
      }
      setTotalPatents(allData.length);

      if (method === "simple") {
        // 単純頻度集計
        const texts = allData.flatMap(item => {
          const keyId = dataSource === "patent" ? item.patent_number : item.openalex_id;
          if (dataSource === "patent") {
            return [
              item.title_en || "",
              item.abstract_epo || "",
              summaryMap[keyId] || "",
              item.claims_independent || "",
              item.description_text || "",
            ];
          } else {
            return [
              item.title || "",
              item.abstract_text || "",
              summaryMap[keyId] || "",
            ];
          }
        });
        const result = extractKeywordsSimple(texts, 50);
        setKeywords(result);
        setPhase("done");

      } else {
        // Claude AI による意味抽出（50件ずつバッチ）
        const BATCH = 50;
        const allKeywords = {};
        const totalBatches = Math.ceil(allData.length / BATCH);
        setPhase("ai");

        for (let i = 0; i < allData.length; i += BATCH) {
          setAiProgress({ done: Math.floor(i/BATCH), total: totalBatches });
          const batch = allData.slice(i, i + BATCH);

          if (dataSource === "patent") {
            const textBlock = batch.map((item, idx) => {
              const p = item;
              const summary = summaryMap[p.patent_number] || "";
              return (idx+1)+". "+p.title_en
                +(p.abstract_epo        ? " / "+p.abstract_epo.slice(0,100)        : "")
                +(summary               ? " / "+summary.slice(0,80)                : "")
                +(p.claims_independent  ? " / Claims: "+p.claims_independent.slice(0,100) : "")
                +(p.description_text    ? " / Desc: "+p.description_text.slice(0,100)     : "");
            }).join("\n");

            const text = await claudePost(
              "Extract the top 20 technology keywords from these patents. Focus on specific technical terms, not generic words.\n\n"
              +"Reply ONLY in this format (one per line):\nKEYWORD:term|count_estimate\n\n"
              +"Patents:\n" + textBlock, 800
            );

            text.split("\n").forEach(line => {
              if (!line.startsWith("KEYWORD:")) return;
              const body = line.slice(8);
              const sep  = body.lastIndexOf("|");
              const kw   = sep > 0 ? body.slice(0, sep).trim().toLowerCase() : body.trim().toLowerCase();
              const cnt  = sep > 0 ? parseInt(body.slice(sep+1)) || 1 : 1;
              if (kw && kw.length > 2) allKeywords[kw] = (allKeywords[kw] || 0) + cnt;
            });
          } else {
            // 論文モード
            const textBlock = batch.map((item, idx) => {
              const p = item;
              const summary = summaryMap[p.openalex_id] || "";
              return (idx+1)+". "+p.title
                +(p.abstract_text    ? " / "+p.abstract_text.slice(0,100)    : "")
                +(summary            ? " / "+summary.slice(0,80)            : "");
            }).join("\n");

            const text = await claudePost(
              "Extract the top 20 research keywords from these academic papers. Focus on specific technical terms, methodologies, and concepts, not generic words.\n\n"
              +"Reply ONLY in this format (one per line):\nKEYWORD:term|count_estimate\n\n"
              +"Papers:\n" + textBlock, 800
            );

            text.split("\n").forEach(line => {
              if (!line.startsWith("KEYWORD:")) return;
              const body = line.slice(8);
              const sep  = body.lastIndexOf("|");
              const kw   = sep > 0 ? body.slice(0, sep).trim().toLowerCase() : body.trim().toLowerCase();
              const cnt  = sep > 0 ? parseInt(body.slice(sep+1)) || 1 : 1;
              if (kw && kw.length > 2) allKeywords[kw] = (allKeywords[kw] || 0) + cnt;
            });
          }

          if (i + BATCH < allData.length) await new Promise(r => setTimeout(r, 600));
        }

        setAiProgress({ done: totalBatches, total: totalBatches });
        const result = Object.entries(allKeywords)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 50)
          .map(([keyword, count]) => ({ keyword, count }));
        setKeywords(result);
        setPhase("done");
      }
    } catch(e) { setErr("エラー: "+e.message); setPhase("idle"); }
  };

  const BAR_COLORS = [
    "#38bdf8","#34d399","#818cf8","#f59e0b","#fb7185",
    "#e879f9","#2dd4bf","#f97316","#a78bfa","#4ade80",
  ];

  return (
    <div style={{flex:1,overflowY:"auto",padding:16}}>

      {/* コントロール */}
      <div style={{...card,marginBottom:16}}>
        <div style={{fontSize:12,fontWeight:700,color:"#e879f9",marginBottom:4}}>🏷️ 技術キーワードランキング</div>

        {/* データソース切替（特許 / 論文） */}
        <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:12}}>
          <label style={{display:"flex",alignItems:"center",gap:6,fontSize:11,cursor:"pointer"}}>
            <input type="radio" name="dataSource" value="patent" checked={dataSource==="patent"} onChange={()=>{setDataSource("patent");setMode("overall");setSelCompany(null);}}/>
            <span style={{color:c.text}}>特許</span>
          </label>
          <label style={{display:"flex",alignItems:"center",gap:6,fontSize:11,cursor:"pointer"}}>
            <input type="radio" name="dataSource" value="paper" checked={dataSource==="paper"} onChange={()=>{setDataSource("paper");setMode("overall");setSelCompany(null);}}/>
            <span style={{color:c.text}}>論文</span>
          </label>
        </div>

        {/* モード切替（全体 / 企業別） — 特許・論文共通 */}
        <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
          <button onClick={()=>setMode("overall")}
            style={{padding:"5px 16px",borderRadius:6,border:"1px solid "+(mode==="overall"?"#e879f9":c.border),background:mode==="overall"?"#1a0a2a":"transparent",color:mode==="overall"?"#e879f9":c.muted,fontSize:12,cursor:"pointer",fontWeight:mode==="overall"?700:400}}>
            🌐 全体ランキング
          </button>
          <button onClick={()=>setMode("company")}
            style={{padding:"5px 16px",borderRadius:6,border:"1px solid "+(mode==="company"?"#e879f9":c.border),background:mode==="company"?"#1a0a2a":"transparent",color:mode==="company"?"#e879f9":c.muted,fontSize:12,cursor:"pointer",fontWeight:mode==="company"?700:400}}>
            🏢 企業別ランキング
          </button>

          {/* ★ 年フィルター（特許: 公開年 / 論文: 出版年） */}
          <div style={{display:"flex",gap:4,alignItems:"center",marginLeft:8}}>
            <span style={{fontSize:11,color:c.muted}}>📅 年：</span>
            <select value={selYear} onChange={e=>setSelYear(e.target.value)}
              style={{padding:"5px 10px",borderRadius:6,border:"1px solid "+(selYear?"#e879f9":c.border),background:c.bg2,color:selYear?"#e879f9":c.text,fontSize:12,outline:"none",cursor:"pointer",fontWeight:selYear?700:400}}>
              <option value="">全期間</option>
              {YEARS.map(y => <option key={y} value={y}>{y}年</option>)}
            </select>
          </div>
        </div>

        {/* 企業選択 */}
        {mode === "company" && (
          <div style={{marginBottom:12}}>
            <div style={{fontSize:11,color:c.muted,marginBottom:6}}>企業を選択</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
              {companies.map(co => (
                <button key={co.id} onClick={()=>setSelCompany(co)}
                  style={{padding:"3px 10px",borderRadius:5,border:"1px solid "+(selCompany?.id===co.id?c.cyan:c.border),background:selCompany?.id===co.id?"#0c2d42":"transparent",color:selCompany?.id===co.id?c.cyan:c.muted,fontSize:11,cursor:"pointer"}}>
                  {co.flag} {co.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 抽出方法 */}
        <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:12,flexWrap:"wrap"}}>
          <div style={{fontSize:11,color:c.muted}}>抽出方法：</div>
          <label style={{display:"flex",alignItems:"center",gap:5,cursor:"pointer",fontSize:11,color:method==="simple"?c.text:c.muted}}>
            <input type="radio" checked={method==="simple"} onChange={()=>setMethod("simple")}/>
            単純頻度集計（無料・即時）
          </label>
          <label style={{display:"flex",alignItems:"center",gap:5,cursor:"pointer",fontSize:11,color:method==="ai"?c.text:c.muted}}>
            <input type="radio" checked={method==="ai"} onChange={()=>setMethod("ai")}/>
            Claude AI抽出（高精度・API使用）
          </label>
        </div>

        <button onClick={doExtract}
          disabled={phase==="loading"||phase==="ai"||(mode==="company"&&!selCompany)}
          style={{padding:"8px 24px",borderRadius:7,border:"none",
            background:phase==="loading"||phase==="ai"||(mode==="company"&&!selCompany)?"#1a3550":"#e879f9",
            color:phase==="loading"||phase==="ai"||(mode==="company"&&!selCompany)?c.muted:"#000",
            fontWeight:700,fontSize:13,cursor:"pointer"}}>
          {phase==="loading"?"データ取得中...":phase==="ai"?"AI分析中 "+aiProgress.done+"/"+aiProgress.total+"バッチ...":"🏷️ ランキングを生成"}
        </button>
      </div>

      {err && <div style={{padding:"8px 12px",background:"#1a1000",borderRadius:6,fontSize:11,color:c.amber,marginBottom:12}}>{err}</div>}

      {/* プログレスバー（AI抽出中） */}
      {phase === "ai" && (
        <div style={{...card,marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#e879f9",marginBottom:6}}>
            <span>Claude AIでキーワードを抽出中...</span>
            <span>{aiProgress.done}/{aiProgress.total}バッチ完了</span>
          </div>
          <div style={{height:5,background:c.bg2,borderRadius:3,overflow:"hidden"}}>
            <div style={{height:"100%",background:"linear-gradient(90deg,#e879f9,#a855f7)",borderRadius:3,
              width:aiProgress.total>0?(aiProgress.done/aiProgress.total*100)+"%":"0%",transition:"width .3s"}}/>
          </div>
        </div>
      )}

      {/* ランキング表示 */}
      {keywords.length > 0 && phase === "done" && (
        <>
          <div style={{fontSize:11,color:c.muted,marginBottom:10}}>
            {dataSource==="patent"?"特許":"論文"} / {mode==="overall"?"全体":"「"+(selCompany?.name||"")+"」"} / {selYear?selYear+"年":"全期間"} / {totalPatents}件から抽出 / 抽出方法: {method==="simple"?"単純頻度集計":"Claude AI"} / TOP{keywords.length}
          </div>
          <div style={{display:"flex",justifyContent:"flex-end",marginBottom:8}}>
            <button
              onClick={() => {
                const header = "順位,キーワード,出現回数";
                const rows = keywords.map((kw, i) => [i+1, '"'+kw.keyword.replace(/"/g,'""')+'"', kw.count].join(","));
                const csv  = [header, ...rows].join("\n");
                const blob = new Blob(["﻿"+csv], {type:"text/csv;charset=utf-8;"});
                const link = document.createElement("a");
                link.href  = URL.createObjectURL(blob);
                const label = mode==="overall" ? "全体" : (selCompany?.name||"企業");
                const meth  = method==="simple" ? "頻度" : "AI";
                const yr    = selYear ? selYear+"年" : "全期間";
                link.download = "キーワードランキング_"+(dataSource==="patent"?"特許":"論文")+"_"+label+"_"+yr+"_"+meth+".csv";
                link.click();
              }}
              style={{padding:"6px 16px",borderRadius:6,border:"1px solid #16a34a",background:"transparent",color:"#16a34a",fontSize:12,fontWeight:600,cursor:"pointer"}}>
              📥 Excelに保存（CSV）
            </button>
          </div>
          <div style={{...card}}>
            {keywords.map((kw, i) => {
              const barColor = BAR_COLORS[i % BAR_COLORS.length];
              const barWidth = Math.max(4, (kw.count / maxCount) * 100);
              return (
                <div key={kw.keyword} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8,padding:"4px 0",borderBottom:"1px solid "+c.border}}>
                  {/* 順位 */}
                  <div style={{fontSize:11,color:i<3?barColor:c.muted,fontWeight:i<3?700:400,minWidth:28,textAlign:"right",fontFamily:"monospace"}}>
                    {i===0?"🥇":i===1?"🥈":i===2?"🥉":"#"+(i+1)}
                  </div>
                  {/* キーワード */}
                  <div style={{fontSize:12,fontWeight:600,color:c.text,minWidth:200}}>{kw.keyword}</div>
                  {/* バー */}
                  <div style={{flex:1,height:6,background:c.bg2,borderRadius:3,overflow:"hidden"}}>
                    <div style={{height:"100%",width:barWidth+"%",background:barColor,borderRadius:3,opacity:.8}}/>
                  </div>
                  {/* カウント */}
                  <div style={{fontSize:11,color:barColor,fontWeight:700,minWidth:40,textAlign:"right",fontFamily:"monospace"}}>
                    {kw.count}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
/* ━━━ 検索タブ統合ラッパー(特許/論文 切替) ━━━ */
function SearchOrPaper(props) {
  const [dataSource, setDataSource] = useState("patent");
  const { c, card } = props;
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{display:"flex",gap:4,padding:"8px 16px",background:c.bg1,borderBottom:"1px solid "+c.border,flexShrink:0}}>
        <button onClick={()=>setDataSource("patent")}
          style={{padding:"5px 18px",borderRadius:6,border:"1px solid "+(dataSource==="patent"?c.cyan:c.border),
            background:dataSource==="patent"?c.bg3:"transparent",color:dataSource==="patent"?c.cyan:c.muted,
            fontSize:12,cursor:"pointer",fontWeight:dataSource==="patent"?700:400}}>
          📋 特許
        </button>
        <button onClick={()=>setDataSource("paper")}
          style={{padding:"5px 18px",borderRadius:6,border:"1px solid "+(dataSource==="paper"?"#34d399":c.border),
            background:dataSource==="paper"?c.bg3:"transparent",color:dataSource==="paper"?"#34d399":c.muted,
            fontSize:12,cursor:"pointer",fontWeight:dataSource==="paper"?700:400}}>
          📄 論文
        </button>
      </div>
      {dataSource === "patent"
        ? <SearchTab {...props} />
        : <PaperExplorer supabaseUrl={props.supabaseUrl} supabaseKey={props.supabaseKey}
            claudeApiKey={props.claudeApiKey} companies={props.companies} c={c} card={card} />
      }
    </div>
  );
}


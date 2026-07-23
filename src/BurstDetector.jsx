import { useState } from "react";

// =============================================================================
// BurstDetector — 論文キーワードのバースト検知
// =============================================================================
// 直近Nヶ月 vs それ以前Mヶ月のベースラインを比較し、出現頻度が急増した
// キーワード（≒新出キーワード）をランキング表示する。
//
// キーワードの単位は2種類から選択可能:
//   ・OpenAlexトピック方式: openalex.works.topics（OpenAlexが論文に自動付与
//     する研究トピック分類タグ）を使用。集計はSQL側（RPC: detect_keyword_bursts）
//     で行うため全社横断でも高速。
//   ・フリーテキスト方式: title/abstractから簡易頻度集計でキーワードを独自抽出
//     （既存の「🏷️ キーワード」タブの簡易抽出ロジックを時系列対応させたもの）。
//     RPC: get_papers_for_burst_text で対象論文の本文を取得し、集計・バースト
//     スコア計算はこのコンポーネント内（クライアント側）で行う。データ量の
//     都合上、全社横断では使用不可（企業を1社指定する必要がある）。
// =============================================================================

// 英語ストップワード（KeywordsTabと同じリスト）
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

// テキストから単語・2-gramの集合を抽出（1論文内の重複は除去 = その論文が触れているか否か）
function extractKeywordSet(text) {
  const set = new Set();
  if (!text) return set;
  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w) set.add(w);
    if (i < words.length - 1 && words[i + 1] && !STOP_WORDS.has(w) && !STOP_WORDS.has(words[i + 1])) {
      set.add(w + " " + words[i + 1]);
    }
  }
  return set;
}

function monthKey(d) { return d.toISOString().slice(0, 7); }

function Sparkline({ series, width = 150, height = 34, color }) {
  if (!series || series.length < 2) {
    return <div style={{ fontSize: 10, color: "#666" }}>データ不足</div>;
  }
  const counts = series.map(s => s.count);
  const max = Math.max(...counts, 1);
  const stepX = width / (series.length - 1);
  const points = series
    .map((s, i) => `${(i * stepX).toFixed(1)},${(height - (s.count / max) * (height - 4) - 2).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function BurstDetector({ supabaseUrl, supabaseKey, companies, c, card }) {
  const [keywordMode, setKeywordMode] = useState("topic"); // topic | freetext
  const [companySlug, setCompanySlug] = useState("");
  const [monthsRecent, setMonthsRecent] = useState(3);
  const [monthsBaseline, setMonthsBaseline] = useState(12);
  const [minRecent, setMinRecent] = useState(5);
  const [topN, setTopN] = useState(30);
  const [loading, setLoading] = useState(false);
  const [loadingNote, setLoadingNote] = useState("");
  const [err, setErr] = useState("");
  const [results, setResults] = useState([]);
  const [ranAt, setRanAt] = useState(null);
  const [ranMode, setRanMode] = useState(null);

  const GROUP_LABELS = { group_west: "欧米", group_china: "中国", group_japan: "日本", group_beauty: "化粧品" };

  const growthColor = (row) => {
    if (row.baseline_count === 0) return "#f87171"; // 新出（ベースライン実質ゼロ）
    if (row.growth_pct >= 200) return "#f87171";
    if (row.growth_pct >= 80) return c.amber;
    return c.cyan;
  };

  // ---- OpenAlexトピック方式（SQL RPCで集計済み） ----
  const detectByTopic = async () => {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/detect_keyword_bursts`, {
      method: "POST",
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        p_company_slug: companySlug || null,
        p_months_recent: Number(monthsRecent) || 3,
        p_months_baseline: Number(monthsBaseline) || 12,
        p_min_recent: Number(minRecent) || 5,
        p_top_n: Number(topN) || 30,
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${t.slice(0, 200)}`);
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  };

  // ---- フリーテキスト方式（本文取得→クライアント側で集計・バースト計算） ----
  const detectByFreeText = async () => {
    const nRecent = Number(monthsRecent) || 3;
    const nBaseline = Number(monthsBaseline) || 12;
    const nMin = Number(minRecent) || 5;
    const nTop = Number(topN) || 30;

    setLoadingNote("対象論文を取得中...");
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/get_papers_for_burst_text`, {
      method: "POST",
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        p_company_slug: companySlug || null,
        p_months_recent: nRecent,
        p_months_baseline: nBaseline,
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${t.slice(0, 200)}`);
    }
    const papers = await res.json();
    if (!Array.isArray(papers) || papers.length === 0) return [];

    setLoadingNote(`${papers.length}件の論文からキーワードを抽出中...`);

    // 月キー一覧（直近nRecentヶ月、ベースラインnBaselineヶ月）
    const now = new Date();
    const recentMonths = [];
    for (let i = 0; i < nRecent; i++) recentMonths.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
    const baselineMonths = [];
    for (let i = nRecent; i < nRecent + nBaseline; i++) baselineMonths.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
    const allMonths = [...baselineMonths, ...recentMonths].sort();
    const recentSet = new Set(recentMonths);
    const baselineSet = new Set(baselineMonths);

    // keyword -> { month: count }
    const monthly = {};
    for (const p of papers) {
      if (!p.pub_month) continue;
      const kws = extractKeywordSet((p.title || "") + " " + (p.abstract_text || ""));
      for (const kw of kws) {
        if (!monthly[kw]) monthly[kw] = {};
        monthly[kw][p.pub_month] = (monthly[kw][p.pub_month] || 0) + 1;
      }
    }

    const rows = [];
    for (const [kw, byMonth] of Object.entries(monthly)) {
      let recent = 0, baseline = 0;
      for (const m of recentSet) recent += byMonth[m] || 0;
      for (const m of baselineSet) baseline += byMonth[m] || 0;
      if (recent < nMin) continue;
      const recentAvg = recent / nRecent;
      const baselineAvg = baseline / nBaseline;
      const burstScore = recentAvg / (baselineAvg + 0.5);
      const growthPct = (100 * (recentAvg - baselineAvg)) / (baselineAvg + 0.5);
      rows.push({
        topic: kw, field: null, domain: null,
        recent_count: recent, baseline_count: baseline,
        recent_avg_monthly: Math.round(recentAvg * 100) / 100,
        baseline_avg_monthly: Math.round(baselineAvg * 100) / 100,
        burst_score: Math.round(burstScore * 100) / 100,
        growth_pct: Math.round(growthPct * 10) / 10,
        monthly_series: allMonths.map(m => ({ month: m, count: byMonth[m] || 0 })),
      });
    }
    rows.sort((a, b) => b.burst_score - a.burst_score || b.recent_count - a.recent_count);
    return rows.slice(0, nTop);
  };

  const doDetect = async () => {
    if (keywordMode === "freetext" && !companySlug) {
      setErr("フリーテキスト方式は企業を1社指定してください（全社横断は非対応）。");
      return;
    }
    setLoading(true); setErr(""); setResults([]); setLoadingNote("");
    try {
      const data = keywordMode === "topic" ? await detectByTopic() : await detectByFreeText();
      setResults(data);
      setRanAt(new Date());
      setRanMode(keywordMode);
    } catch (e) {
      setErr("バースト検知エラー: " + e.message);
    }
    setLoading(false); setLoadingNote("");
  };

  const downloadCSV = () => {
    if (!results.length) return;
    const header = "キーワード,分野,ドメイン,直近件数,ベースライン件数,直近月平均,ベースライン月平均,バーストスコア,成長率(%)";
    const rows = results.map(r => [
      '"' + (r.topic || "").replace(/"/g, '""') + '"',
      '"' + (r.field || "") + '"',
      '"' + (r.domain || "") + '"',
      r.recent_count, r.baseline_count, r.recent_avg_monthly, r.baseline_avg_monthly, r.burst_score, r.growth_pct,
    ].join(","));
    const blob = new Blob(["﻿", [header, ...rows].join("\n")], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "keyword_bursts.csv";
    link.click();
  };

  return (
    <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
      {/* ===== 左パネル: 条件設定 ===== */}
      <div style={{ width: 220, borderRight: "1px solid " + c.border, background: c.bg1, overflowY: "auto", padding: 12, flexShrink: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: c.muted, marginBottom: 10, letterSpacing: ".06em" }}>バースト検知条件</div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: c.muted, marginBottom: 4 }}>キーワード方式</div>
          <select value={keywordMode} onChange={e => setKeywordMode(e.target.value)}
            style={{ width: "100%", padding: "7px 8px", borderRadius: 7, border: "1px solid " + c.border, background: c.bg2, color: c.text, fontSize: 12, cursor: "pointer", boxSizing: "border-box" }}>
            <option value="topic">OpenAlexトピック（全社横断可・高速）</option>
            <option value="freetext">フリーテキスト簡易抽出（企業1社指定必須）</option>
          </select>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: c.muted, marginBottom: 4 }}>企業</div>
          <select value={companySlug} onChange={e => setCompanySlug(e.target.value)}
            style={{ width: "100%", padding: "7px 8px", borderRadius: 7, border: "1px solid " + c.border, background: c.bg2, color: c.text, fontSize: 12, cursor: "pointer", boxSizing: "border-box" }}>
            <option value="">すべて（全社横断）</option>
            {Object.entries(GROUP_LABELS).map(([gid, label]) => (
              <optgroup key={gid} label={label}>
                {(companies || []).filter(co => co.group_id === gid).map(co => <option key={co.id} value={co.id}>{co.name}</option>)}
              </optgroup>
            ))}
          </select>
          {keywordMode === "freetext" && !companySlug && (
            <div style={{ fontSize: 9, color: "#f87171", marginTop: 4 }}>フリーテキスト方式では企業を選択してください</div>
          )}
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: c.muted, marginBottom: 4 }}>直近期間（ヶ月）</div>
          <input type="number" min={1} max={24} value={monthsRecent} onChange={e => setMonthsRecent(e.target.value)}
            style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid " + c.border, background: c.bg2, color: c.text, fontSize: 12, boxSizing: "border-box" }} />
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: c.muted, marginBottom: 4 }}>ベースライン期間（ヶ月）</div>
          <input type="number" min={1} max={48} value={monthsBaseline} onChange={e => setMonthsBaseline(e.target.value)}
            style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid " + c.border, background: c.bg2, color: c.text, fontSize: 12, boxSizing: "border-box" }} />
          <div style={{ fontSize: 9, color: c.muted, marginTop: 4 }}>直近期間の直前、この期間の月平均と比較します</div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: c.muted, marginBottom: 4 }}>最小出現数（直近期間）</div>
          <input type="number" min={1} max={1000} value={minRecent} onChange={e => setMinRecent(e.target.value)}
            style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid " + c.border, background: c.bg2, color: c.text, fontSize: 12, boxSizing: "border-box" }} />
          <div style={{ fontSize: 9, color: c.muted, marginTop: 4 }}>ノイズ除去用（少数件のみのキーワードを除外）</div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: c.muted, marginBottom: 4 }}>表示件数（上位）</div>
          <input type="number" min={5} max={100} value={topN} onChange={e => setTopN(e.target.value)}
            style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid " + c.border, background: c.bg2, color: c.text, fontSize: 12, boxSizing: "border-box" }} />
        </div>

        <button onClick={doDetect} disabled={loading}
          style={{ width: "100%", padding: "8px 0", borderRadius: 7, border: "none", background: loading ? c.bg3 : c.cyan, color: loading ? c.muted : "#000", fontWeight: 700, fontSize: 13, cursor: loading ? "not-allowed" : "pointer", marginBottom: 8 }}>
          {loading ? (loadingNote || "検知中...") : "🔥 検知実行"}
        </button>

        {results.length > 0 && (
          <button onClick={downloadCSV}
            style={{ width: "100%", padding: "6px 0", borderRadius: 7, border: "1px solid #16a34a", background: "transparent", color: "#16a34a", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
            📥 CSV保存
          </button>
        )}

        <div style={{ borderTop: "1px solid " + c.border, marginTop: 12, paddingTop: 10, fontSize: 10, color: c.muted, lineHeight: 1.8 }}>
          {keywordMode === "topic"
            ? "※「キーワード」は OpenAlex が論文に付与する研究トピック分類タグ（上位5件/論文）を使用しています。"
            : "※ title/abstract の英単語・2語連結（2-gram）を簡易頻度集計したものです。ストップワードは除外していますが、AI抽出に比べると粒度は粗めです。"}
        </div>
      </div>

      {/* ===== 右: 結果 ===== */}
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 16px" }}>
        {err && <div style={{ padding: "8px 12px", background: "#1a1000", borderRadius: 6, fontSize: 11, color: c.amber, marginBottom: 10 }}>{err}</div>}

        {!loading && results.length === 0 && !err && (
          <div style={{ padding: 60, textAlign: "center", color: c.muted, fontSize: 14 }}>
            左のパネルで条件を設定して「検知実行」を押してください。
          </div>
        )}

        {ranAt && (
          <div style={{ fontSize: 11, color: c.muted, marginBottom: 12 }}>
            {results.length}件検出 ／ {ranMode === "topic" ? "OpenAlexトピック方式" : "フリーテキスト方式"} ／
            直近{monthsRecent}ヶ月 vs ベースライン{monthsBaseline}ヶ月 ／ 実行: {ranAt.toLocaleString("ja-JP")}
          </div>
        )}

        {results.map((r, idx) => {
          const color = growthColor(r);
          const isNew = r.baseline_count === 0;
          return (
            <div key={r.topic + "_" + idx} style={{ ...card, marginBottom: 10, border: "1px solid " + c.border }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: c.cyan, flexShrink: 0, minWidth: 22 }}>#{idx + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{r.topic}</span>
                    {isNew && <span style={{ fontSize: 9, color: "#f87171", padding: "1px 6px", borderRadius: 3, border: "1px solid #f87171" }}>新出</span>}
                  </div>
                  {(r.field || r.domain) && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                      {r.field && <span style={{ fontSize: 10, color: c.muted, padding: "1px 6px", borderRadius: 3, border: "1px solid " + c.border }}>{r.field}</span>}
                      {r.domain && <span style={{ fontSize: 10, color: c.muted }}>{r.domain}</span>}
                    </div>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontSize: 9, color: c.muted }}>直近{monthsRecent}ヶ月</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: c.text }}>{r.recent_count}件</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 9, color: c.muted }}>ベースライン月平均</div>
                      <div style={{ fontSize: 13, color: c.text }}>{r.baseline_avg_monthly}件/月</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 9, color: c.muted }}>成長率</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color }}>{isNew ? "新出" : (r.growth_pct > 0 ? "+" : "") + r.growth_pct + "%"}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 9, color: c.muted }}>バーストスコア</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color }}>{r.burst_score}</div>
                    </div>
                    <div style={{ marginLeft: "auto" }}>
                      <Sparkline series={r.monthly_series} color={color} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

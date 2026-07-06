import { useState, useEffect, useMemo, useCallback } from "react";

// =============================================================================
// PaperExplorer v3 — ダークテーマ + AI解説 + AI分析
// =============================================================================
// Dashboard.jsx の SearchTab と同じ場所に統合して使う。
// props: supabaseUrl, supabaseKey, claudeApiKey, companies, c, card
// =============================================================================

export default function PaperExplorer({ supabaseUrl, supabaseKey, claudeApiKey, companies, c, card }) {
  const [results, setResults]     = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading]     = useState(false);
  const [err, setErr]             = useState("");

  const [keyword, setKeyword]       = useState("");
  const [companySlug, setCompanySlug] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [sortBy, setSortBy]         = useState("cited_by_count");
  const [page, setPage]             = useState(0);
  const PAGE_SIZE = 20;

  // 詳細・AI
  const [openId, setOpenId]         = useState(null);
  const [aiPhase, setAiPhase]       = useState("idle");  // idle | loading | done
  const [aiResult, setAiResult]     = useState(null);
  const [batchPhase, setBatchPhase] = useState("idle");   // idle | analyzing | done
  const [batchResult, setBatchResult] = useState(null);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });

  const GROUP_LABELS = { group_west: "欧米", group_china: "中国", group_japan: "日本", group_beauty: "化粧品" };
  const coMap = useMemo(() => Object.fromEntries((companies || []).map(co => [co.id, co])), [companies]);
  const coName = (slug) => coMap[slug]?.name || slug;

  // ---- Claude API ----
  const claudePost = useCallback(async (prompt, maxTokens = 1500) => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
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
    if (!res.ok) throw new Error("Claude API error: " + res.status);
    const data = await res.json();
    return data.content?.[0]?.text || "";
  }, [claudeApiKey]);

  // ---- 検索 ----
  const doSearch = useCallback(async (newPage = 0) => {
    setLoading(true); setErr(""); setOpenId(null); setAiResult(null); setAiPhase("idle");
    setPage(newPage);
    let filters = [];
    if (keyword.trim()) {
      const kw = keyword.trim().replace(/%/g, "");
      filters.push(`or=(title.ilike.*${kw}*,abstract_text.ilike.*${kw}*)`);
    }
    if (companySlug) filters.push(`company_slug=eq.${companySlug}`);
    if (yearFilter) filters.push(`publication_year=eq.${yearFilter}`);
    const orderCol = sortBy === "year" ? "publication_year.desc,cited_by_count.desc" : "cited_by_count.desc,publication_year.desc";
    const qs = [
      "select=openalex_id,doi,title,publication_year,cited_by_count,is_oa,oa_url,source_name,type,company_slug,abstract_text,topics",
      ...filters, `order=${orderCol}`, `limit=${PAGE_SIZE}`, `offset=${newPage * PAGE_SIZE}`,
    ].join("&");
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/papers_search?${qs}`, {
        headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Accept-Profile": "openalex", Prefer: "count=estimated" }
      });
      const cr = res.headers.get("content-range");
      if (cr) { const m = cr.match(/\/(\d+)/); if (m) setTotalCount(parseInt(m[1])); }
      const data = await res.json();
      setResults(Array.isArray(data) ? data : []);
    } catch (e) { setErr("検索エラー: " + e.message); setResults([]); }
    setLoading(false);
  }, [keyword, companySlug, yearFilter, sortBy, supabaseUrl, supabaseKey]);

  useEffect(() => { doSearch(0); }, []);

  const parseTopics = (raw) => {
    if (!raw) return [];
    try { const p = typeof raw === "string" ? JSON.parse(raw) : raw; return Array.isArray(p) ? p : []; } catch { return []; }
  };

  // ---- AI解説(個別論文) ----
  const doAiExplain = async (paper) => {
    setAiPhase("loading"); setAiResult(null);
    try {
      const topics = parseTopics(paper.topics).map(t => t.display_name).join(", ");
      const text = await claudePost(
        `以下の学術論文を、特許アナリストの視点で日本語で解説してください。\n\n`
        + `タイトル: ${paper.title}\n`
        + `発行年: ${paper.publication_year}\n`
        + `掲載誌: ${paper.source_name || "不明"}\n`
        + `被引用数: ${paper.cited_by_count}\n`
        + `トピック: ${topics}\n`
        + `要約: ${paper.abstract_text || "(なし)"}\n\n`
        + `以下の観点で解説してください:\n`
        + `1. 技術概要(この研究が何を解決しようとしているか)\n`
        + `2. 技術的新規性(従来手法と比べた革新点)\n`
        + `3. 産業応用可能性(どのような製品・サービスに応用できるか)\n`
        + `4. 関連する特許領域(この研究が特許化される場合、どのIPC分類に該当しそうか)\n`
        + `5. 2040年に向けた将来展望\n`
        + `6. 総合評価スコア(革新性/産業応用性/将来性を各10点満点で)\n\n`
        + `各セクションは見出し付きで、わかりやすく記述してください。`, 2000
      );
      setAiResult(text);
      setAiPhase("done");
    } catch (e) { setErr("AI解説エラー: " + e.message); setAiPhase("idle"); }
  };

  // ---- AI分析(検索結果全体) ----
  const doAiBatchAnalysis = async () => {
    setBatchPhase("analyzing"); setBatchResult(null);
    try {
      // 全件取得(最大500件)
      let filters = [];
      if (keyword.trim()) filters.push(`or=(title.ilike.*${keyword.trim()}*,abstract_text.ilike.*${keyword.trim()}*)`);
      if (companySlug) filters.push(`company_slug=eq.${companySlug}`);
      if (yearFilter) filters.push(`publication_year=eq.${yearFilter}`);
      const qs = ["select=openalex_id,title,publication_year,cited_by_count,source_name,company_slug,abstract_text,topics",
        ...filters, "order=cited_by_count.desc", "limit=500"].join("&");
      const res = await fetch(`${supabaseUrl}/rest/v1/papers_search?${qs}`, {
        headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Accept-Profile": "openalex" }
      });
      const allPapers = await res.json();
      if (!allPapers.length) { setErr("分析対象の論文がありません"); setBatchPhase("idle"); return; }

      const BATCH = 50;
      const batches = [];
      for (let i = 0; i < allPapers.length; i += BATCH) batches.push(allPapers.slice(i, i + BATCH));
      const batchSummaries = [];

      for (let b = 0; b < batches.length; b++) {
        setBatchProgress({ done: b, total: batches.length });
        const batch = batches[b];
        const list = batch.map((p, i) => {
          const co = coName(p.company_slug);
          const abs = (p.abstract_text || "").split(/\s+/).slice(0, 100).join(" ");
          return `${i + 1}. [${p.publication_year}] ${p.title} — ${co} (cited:${p.cited_by_count})\n   ${abs}`;
        }).join("\n");

        const bText = await claudePost(
          `あなたは技術インテリジェンスアナリストです。以下の学術論文バッチを分析し、技術動向を抽出してください。\n\n`
          + `バッチ${b + 1}/${batches.length} (${batch.length}件):\n${list}\n\n`
          + `以下の形式で回答:\n`
          + `THEME1:テーマ名|説明(2文)\n`
          + `THEME2:テーマ名|説明(2文)\n`
          + `THEME3:テーマ名|説明(2文)\n`
          + `NOTABLE:最注目論文のタイトルと革新点(2文)`, 1200
        );
        batchSummaries.push(bText);
        if (b < batches.length - 1) await new Promise(r => setTimeout(r, 600));
      }

      setBatchProgress({ done: batches.length, total: batches.length });

      // 統合分析
      const filterDesc = [
        keyword ? `キーワード: "${keyword}"` : null,
        companySlug ? `企業: ${coName(companySlug)}` : null,
        yearFilter ? `年: ${yearFilter}` : null,
      ].filter(Boolean).join(" / ") || "フィルターなし";

      const synthesis = await claudePost(
        `以下のバッチ分析結果を統合して、研究動向の総合レポートを日本語で作成してください。\n\n`
        + `対象: ${allPapers.length}件の学術論文 (${filterDesc})\n\n`
        + `バッチ分析結果:\n${batchSummaries.join("\n---\n")}\n\n`
        + `以下の構成で記述してください:\n`
        + `## 主要研究テーマ(上位5つ、各テーマに3文の説明)\n`
        + `## 技術トレンド(3つ、各トレンドに4文の分析)\n`
        + `## 産業への示唆(この研究群が示す産業変化の方向性)\n`
        + `## 最注目論文(2件、各2文で紹介)\n`
        + `## IP転換の可能性(この研究群で特許化が進みそうな領域の予測)`, 2500
      );

      setBatchResult(synthesis);
      setBatchPhase("done");
    } catch (e) { setErr("AI分析エラー: " + e.message); setBatchPhase("idle"); }
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
      {/* ===== 左: フィルタパネル ===== */}
      <div style={{ width: 240, flexShrink: 0, padding: 14, borderRight: "1px solid " + c.border, overflowY: "auto", background: c.bg1 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: c.cyan, marginBottom: 14 }}>📄 論文検索</div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: c.muted, marginBottom: 4 }}>キーワード（英語）</div>
          <input style={{ ...inputS, background: c.bg2, color: c.text, border: "1px solid " + c.border }}
            placeholder="transformer, battery..." value={keyword}
            onChange={e => setKeyword(e.target.value)} onKeyDown={e => e.key === "Enter" && doSearch(0)} />
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: c.muted, marginBottom: 4 }}>企業</div>
          <select style={{ ...selectS, background: c.bg2, color: c.text, border: "1px solid " + c.border }}
            value={companySlug} onChange={e => setCompanySlug(e.target.value)}>
            <option value="">すべて</option>
            {Object.entries(GROUP_LABELS).map(([gid, label]) => (
              <optgroup key={gid} label={label}>
                {(companies || []).filter(co => co.group_id === gid).map(co =>
                  <option key={co.id} value={co.id}>{co.name}</option>
                )}
              </optgroup>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: c.muted, marginBottom: 4 }}>発行年</div>
          <select style={{ ...selectS, background: c.bg2, color: c.text, border: "1px solid " + c.border }}
            value={yearFilter} onChange={e => setYearFilter(e.target.value)}>
            <option value="">すべて</option>
            {[2026, 2025, 2024, 2023, 2022].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, color: c.muted, marginBottom: 4 }}>並び順</div>
          <select style={{ ...selectS, background: c.bg2, color: c.text, border: "1px solid " + c.border }}
            value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="cited_by_count">被引用数</option>
            <option value="year">新着</option>
          </select>
        </div>

        <button onClick={() => doSearch(0)}
          style={{ width: "100%", padding: "8px 0", borderRadius: 6, border: "none", background: c.cyan, color: "#000", fontWeight: 700, fontSize: 13, cursor: "pointer", marginBottom: 8 }}>
          {loading ? "検索中..." : "🔍 検索"}
        </button>
        <button onClick={() => { setKeyword(""); setCompanySlug(""); setYearFilter(""); }}
          style={{ width: "100%", padding: "6px 0", borderRadius: 6, border: "1px solid " + c.border, background: "transparent", color: c.muted, fontSize: 11, cursor: "pointer", marginBottom: 14 }}>
          リセット
        </button>

        <div style={{ fontSize: 12, fontWeight: 700, color: c.cyan }}>{totalCount.toLocaleString()} 件</div>

        {/* AI分析ボタン */}
        {totalCount > 0 && (
          <div style={{ marginTop: 16, borderTop: "1px solid " + c.border, paddingTop: 12 }}>
            <button onClick={doAiBatchAnalysis} disabled={batchPhase === "analyzing"}
              style={{ width: "100%", padding: "8px 0", borderRadius: 6, border: "none",
                background: batchPhase === "analyzing" ? c.bg3 : "#818cf8", color: batchPhase === "analyzing" ? c.muted : "#fff",
                fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
              {batchPhase === "analyzing" ? `🤖 分析中 ${batchProgress.done}/${batchProgress.total}` : "🤖 AI分析"}
            </button>
          </div>
        )}
      </div>

      {/* ===== 右: 結果エリア ===== */}
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 16px" }}>
        {err && <div style={{ padding: "8px 12px", background: "#1a1000", borderRadius: 6, fontSize: 11, color: c.amber, marginBottom: 10 }}>{err}</div>}

        {/* AI分析結果 */}
        {batchPhase === "done" && batchResult && (
          <div style={{ ...card, marginBottom: 14, borderColor: "#818cf8" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#818cf8", marginBottom: 8 }}>🤖 AI研究動向分析</div>
            <div style={{ fontSize: 12, lineHeight: 1.8, color: c.text, whiteSpace: "pre-wrap" }}>{batchResult}</div>
            <button onClick={() => setBatchResult(null)}
              style={{ marginTop: 8, padding: "4px 12px", borderRadius: 4, border: "1px solid " + c.border, background: "transparent", color: c.muted, fontSize: 10, cursor: "pointer" }}>
              閉じる
            </button>
          </div>
        )}

        {results.length === 0 && !loading && (
          <div style={{ padding: 60, textAlign: "center", color: c.muted, fontSize: 14 }}>検索条件に一致する論文がありません</div>
        )}

        {results.map((r, idx) => {
          const topics = parseTopics(r.topics);
          const isOpen = openId === r.openalex_id;
          return (
            <div key={r.openalex_id + "_" + idx} style={{ borderBottom: "1px solid " + c.border }}>
              {/* カードヘッダー */}
              <div style={{ padding: "10px 8px", cursor: "pointer" }}
                onClick={() => { setOpenId(isOpen ? null : r.openalex_id); setAiPhase("idle"); setAiResult(null); }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", lineHeight: 1.5, marginBottom: 4 }}>
                  {r.title || "(タイトルなし)"}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", fontSize: 11 }}>
                  <span style={{ padding: "1px 6px", background: "#1e1b4b", color: c.purple, borderRadius: 3, fontWeight: 700, fontSize: 10 }}>{r.publication_year}</span>
                  <span style={{ padding: "1px 6px", background: "#052e16", color: c.green, borderRadius: 3, fontWeight: 600, fontSize: 10 }}>{coName(r.company_slug)}</span>
                  <span style={{ padding: "1px 6px", background: c.bg2, color: c.muted, borderRadius: 3, fontSize: 10 }}>{r.type || "article"}</span>
                  {r.is_oa && <span style={{ padding: "1px 6px", background: "#052e16", color: "#4ade80", borderRadius: 3, fontWeight: 700, fontSize: 10 }}>OA</span>}
                  <span style={{ color: c.muted, fontFamily: "monospace", fontSize: 11, marginLeft: "auto" }}>被引用 {(r.cited_by_count || 0).toLocaleString()}</span>
                </div>
                {topics.length > 0 && (
                  <div style={{ display: "flex", gap: 4, marginTop: 5, flexWrap: "wrap" }}>
                    {topics.slice(0, 3).map((t, i) =>
                      <span key={i} style={{ fontSize: 9, padding: "1px 7px", background: c.bg2, borderRadius: 10, color: c.muted }}>{t.display_name}</span>
                    )}
                  </div>
                )}
              </div>

              {/* 展開詳細 */}
              {isOpen && (
                <div style={{ padding: "0 8px 14px" }}>
                  {/* リンク行 */}
                  <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                    {r.oa_url && (
                      <a href={r.oa_url} target="_blank" rel="noreferrer"
                        style={{ padding: "5px 12px", background: "#059669", color: "#fff", borderRadius: 5, fontSize: 11, fontWeight: 600, textDecoration: "none" }}>
                        📖 全文を読む
                      </a>
                    )}
                    {r.doi && (
                      <a href={`https://doi.org/${r.doi}`} target="_blank" rel="noreferrer"
                        style={{ padding: "5px 12px", background: c.bg2, color: c.cyan, border: "1px solid " + c.border, borderRadius: 5, fontSize: 11, textDecoration: "none" }}>
                        🔗 DOI
                      </a>
                    )}
                    <a href={`https://openalex.org/${r.openalex_id}`} target="_blank" rel="noreferrer"
                      style={{ padding: "5px 12px", background: c.bg2, color: c.muted, border: "1px solid " + c.border, borderRadius: 5, fontSize: 11, textDecoration: "none" }}>
                      OpenAlex
                    </a>
                    <button onClick={() => doAiExplain(r)} disabled={aiPhase === "loading"}
                      style={{ padding: "5px 12px", background: aiPhase === "loading" ? c.bg3 : "#818cf8", color: "#fff", border: "none", borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                      {aiPhase === "loading" ? "⏳ 解説生成中..." : "🤖 AI解説"}
                    </button>
                  </div>

                  {/* 要約 */}
                  {r.abstract_text && (
                    <div style={{ ...card, marginBottom: 10 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: c.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>Abstract</div>
                      <div style={{ fontSize: 12, lineHeight: 1.8, color: c.text }}>{r.abstract_text}</div>
                    </div>
                  )}

                  {/* AI解説結果 */}
                  {aiPhase === "done" && aiResult && (
                    <div style={{ ...card, borderColor: "#818cf8", marginBottom: 10 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#818cf8", marginBottom: 6 }}>🤖 AI解説</div>
                      <div style={{ fontSize: 12, lineHeight: 1.8, color: c.text, whiteSpace: "pre-wrap" }}>{aiResult}</div>
                    </div>
                  )}

                  {/* 統計 */}
                  <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                    {[
                      { n: (r.cited_by_count || 0).toLocaleString(), l: "被引用数" },
                      { n: r.publication_year, l: "発行年" },
                      { n: r.is_oa ? "Yes" : "No", l: "OA" },
                      { n: r.type || "—", l: "種別" },
                    ].map((s, i) => (
                      <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "6px 10px", background: c.bg2, borderRadius: 6 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: c.text, fontFamily: "monospace" }}>{s.n}</div>
                        <div style={{ fontSize: 9, color: c.muted }}>{s.l}</div>
                      </div>
                    ))}
                  </div>

                  {/* トピック詳細 */}
                  {topics.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: c.muted, marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 }}>Topics</div>
                      {parseTopics(r.topics).map((t, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid " + c.border, fontSize: 11 }}>
                          <span style={{ color: c.text, fontWeight: 600 }}>{t.display_name}</span>
                          <span style={{ color: c.muted, fontSize: 10 }}>{t.domain} › {t.field}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* ページネーション */}
        {totalPages > 1 && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 16, padding: "14px 0" }}>
            <button disabled={page === 0} onClick={() => doSearch(page - 1)}
              style={{ padding: "5px 14px", borderRadius: 5, border: "1px solid " + c.border, background: "transparent", color: c.muted, fontSize: 12, cursor: "pointer" }}>← 前</button>
            <span style={{ fontSize: 12, color: c.muted }}>{page * PAGE_SIZE + 1}〜{Math.min((page + 1) * PAGE_SIZE, totalCount)} / {totalCount.toLocaleString()}</span>
            <button disabled={page >= totalPages - 1} onClick={() => doSearch(page + 1)}
              style={{ padding: "5px 14px", borderRadius: 5, border: "1px solid " + c.border, background: "transparent", color: c.muted, fontSize: 12, cursor: "pointer" }}>次 →</button>
          </div>
        )}
      </div>
    </div>
  );
}

const inputS = { width: "100%", padding: "6px 8px", borderRadius: 5, fontSize: 12, outline: "none", fontFamily: "inherit" };
const selectS = { width: "100%", padding: "6px 8px", borderRadius: 5, fontSize: 12, cursor: "pointer", fontFamily: "inherit" };

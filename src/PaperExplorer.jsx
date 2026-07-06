import { useState, useEffect, useMemo, useCallback } from "react";

// =============================================================================
// PaperExplorer v2 — 論文検索・閲覧(特許UIに準拠)
// =============================================================================

export default function PaperExplorer({ supabaseUrl, supabaseKey }) {
  const [companies, setCompanies] = useState([]);
  const [results, setResults]     = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading]     = useState(false);
  const [detail, setDetail]       = useState(null);

  const [keyword, setKeyword]       = useState("");
  const [companySlug, setCompanySlug] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [sortBy, setSortBy]         = useState("cited_by_count");
  const [page, setPage]             = useState(0);
  const PAGE_SIZE = 30;

  const GROUP_LABELS = { group_west: "欧米", group_china: "中国", group_japan: "日本", group_beauty: "化粧品" };

  useEffect(() => {
    fetch(`${supabaseUrl}/rest/v1/companies?select=id,name,group_id&order=group_id,name&limit=100`, {
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }
    }).then(r => r.json()).then(d => setCompanies(Array.isArray(d) ? d : []));
  }, []);

  const coMap = useMemo(() => Object.fromEntries(companies.map(c => [c.id, c])), [companies]);
  const coName = (slug) => coMap[slug]?.name || slug;

  // ---- 検索 ----
  const doSearch = useCallback(async (newPage = 0) => {
    setLoading(true);
    setPage(newPage);
    setDetail(null);

    let filters = [];
    if (keyword.trim()) {
      const kw = keyword.trim().replace(/%/g, "");
      filters.push(`or=(title.ilike.*${kw}*,abstract_text.ilike.*${kw}*)`);
    }
    if (companySlug) filters.push(`company_slug=eq.${companySlug}`);
    if (yearFilter) filters.push(`publication_year=eq.${yearFilter}`);

    const orderCol = sortBy === "year" ? "publication_year.desc,cited_by_count.desc"
                   : "cited_by_count.desc,publication_year.desc";
    const offset = newPage * PAGE_SIZE;

    const qs = [
      "select=openalex_id,doi,title,publication_year,cited_by_count,is_oa,oa_url,source_name,type,company_slug,abstract_text,topics",
      ...filters,
      `order=${orderCol}`,
      `limit=${PAGE_SIZE}`,
      `offset=${offset}`,
    ].join("&");

    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/papers_search?${qs}`, {
        headers: {
          apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`,
          "Accept-Profile": "openalex", Prefer: "count=estimated",
        }
      });
      const cr = res.headers.get("content-range");
      if (cr) { const m = cr.match(/\/(\d+)/); if (m) setTotalCount(parseInt(m[1])); }
      const data = await res.json();
      setResults(Array.isArray(data) ? data : []);
    } catch (e) { console.error(e); setResults([]); }
    setLoading(false);
  }, [keyword, companySlug, yearFilter, sortBy, supabaseUrl, supabaseKey]);

  useEffect(() => { doSearch(0); }, []);

  const parseTopics = (raw) => {
    if (!raw) return [];
    try { const p = typeof raw === "string" ? JSON.parse(raw) : raw; return Array.isArray(p) ? p : []; }
    catch { return []; }
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div style={S.wrap}>
      {/* ========== 検索パネル ========== */}
      <div style={S.searchPanel}>
        <div style={S.searchTitle}>📄 論文検索</div>
        <div style={S.searchGrid}>
          <div style={S.fieldGroup}>
            <label style={S.label}>キーワード</label>
            <input style={S.input} type="text" placeholder="英語で入力（例: transformer, battery, LiDAR）"
              value={keyword} onChange={e => setKeyword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && doSearch(0)} />
          </div>
          <div style={S.fieldGroup}>
            <label style={S.label}>企業</label>
            <select style={S.select} value={companySlug} onChange={e => setCompanySlug(e.target.value)}>
              <option value="">すべて</option>
              {Object.entries(GROUP_LABELS).map(([gid, label]) => (
                <optgroup key={gid} label={label}>
                  {companies.filter(c => c.group_id === gid).map(c =>
                    <option key={c.id} value={c.id}>{c.name}</option>
                  )}
                </optgroup>
              ))}
            </select>
          </div>
          <div style={S.fieldGroup}>
            <label style={S.label}>発行年</label>
            <select style={S.select} value={yearFilter} onChange={e => setYearFilter(e.target.value)}>
              <option value="">すべて</option>
              {[2026,2025,2024,2023,2022].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div style={S.fieldGroup}>
            <label style={S.label}>並び順</label>
            <select style={S.select} value={sortBy} onChange={e => setSortBy(e.target.value)}>
              <option value="cited_by_count">被引用数</option>
              <option value="year">新着</option>
            </select>
          </div>
        </div>
        <div style={S.searchActions}>
          <button style={S.primaryBtn} onClick={() => doSearch(0)}>
            {loading ? "検索中..." : "検索"}
          </button>
          <button style={S.secondaryBtn} onClick={() => {
            setKeyword(""); setCompanySlug(""); setYearFilter(""); setSortBy("cited_by_count");
          }}>リセット</button>
          <span style={S.resultCount}>{totalCount.toLocaleString()} 件</span>
        </div>
      </div>

      {/* ========== 検索結果 ========== */}
      <div style={S.resultArea}>
        {results.length === 0 && !loading && (
          <div style={S.empty}>検索条件に一致する論文がありません</div>
        )}

        {results.map((r, idx) => {
          const topics = parseTopics(r.topics);
          const isOpen = detail === r.openalex_id;
          return (
            <div key={r.openalex_id + "_" + idx} style={S.card}>
              {/* カードヘッダー */}
              <div style={S.cardHeader} onClick={() => setDetail(isOpen ? null : r.openalex_id)}>
                <div style={S.cardTitleRow}>
                  <span style={S.cardTitle}>{r.title || "(タイトルなし)"}</span>
                  <span style={S.expandIcon}>{isOpen ? "▼" : "▶"}</span>
                </div>
                <div style={S.cardMeta}>
                  <span style={S.badge}>{r.publication_year}</span>
                  <span style={S.badgeCompany}>{coName(r.company_slug)}</span>
                  <span style={S.badgeType}>{r.type || "article"}</span>
                  {r.is_oa && <span style={S.badgeOA}>OA</span>}
                  <span style={S.citedCount}>被引用 {(r.cited_by_count || 0).toLocaleString()}</span>
                  {r.source_name && <span style={S.sourceName}>{r.source_name}</span>}
                </div>
                {topics.length > 0 && (
                  <div style={S.topicRow}>
                    {topics.slice(0, 3).map((t, i) =>
                      <span key={i} style={S.topicTag}>{t.display_name}</span>
                    )}
                  </div>
                )}
              </div>

              {/* 展開時の詳細 */}
              {isOpen && (
                <div style={S.cardBody}>
                  {/* リンクボタン行 */}
                  <div style={S.linkRow}>
                    {r.oa_url && (
                      <a href={r.oa_url} target="_blank" rel="noreferrer" style={S.oaBtn}>
                        📖 全文を読む（Open Access）
                      </a>
                    )}
                    {r.doi && (
                      <a href={`https://doi.org/${r.doi}`} target="_blank" rel="noreferrer" style={S.doiBtn}>
                        🔗 DOI: {r.doi}
                      </a>
                    )}
                    <a href={`https://openalex.org/${r.openalex_id}`} target="_blank" rel="noreferrer" style={S.oaLinkBtn}>
                      OpenAlex
                    </a>
                  </div>

                  {/* 要約 */}
                  {r.abstract_text && (
                    <div style={S.abstractBox}>
                      <div style={S.sectionLabel}>要約 (Abstract)</div>
                      <div style={S.abstractText}>{r.abstract_text}</div>
                    </div>
                  )}

                  {/* 統計 */}
                  <div style={S.statsRow}>
                    <div style={S.statBox}>
                      <div style={S.statNum}>{(r.cited_by_count || 0).toLocaleString()}</div>
                      <div style={S.statLabel}>被引用数</div>
                    </div>
                    <div style={S.statBox}>
                      <div style={S.statNum}>{r.publication_year}</div>
                      <div style={S.statLabel}>発行年</div>
                    </div>
                    <div style={S.statBox}>
                      <div style={S.statNum}>{r.is_oa ? "Yes" : "No"}</div>
                      <div style={S.statLabel}>OA</div>
                    </div>
                    <div style={S.statBox}>
                      <div style={S.statNum}>{r.type || "—"}</div>
                      <div style={S.statLabel}>種別</div>
                    </div>
                  </div>

                  {/* トピック詳細 */}
                  {topics.length > 0 && (
                    <div style={S.topicDetail}>
                      <div style={S.sectionLabel}>トピック</div>
                      {topics.map((t, i) => (
                        <div key={i} style={S.topicDetailRow}>
                          <span style={S.topicDetailName}>{t.display_name}</span>
                          <span style={S.topicDetailField}>{t.domain} › {t.field} › {t.subfield}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ========== ページネーション ========== */}
      {totalPages > 1 && (
        <div style={S.pagination}>
          <button style={S.pageBtn} disabled={page === 0} onClick={() => doSearch(page - 1)}>← 前</button>
          <span style={S.pageInfo}>
            {page * PAGE_SIZE + 1}〜{Math.min((page + 1) * PAGE_SIZE, totalCount)} / {totalCount.toLocaleString()}件
          </span>
          <button style={S.pageBtn} disabled={page >= totalPages - 1} onClick={() => doSearch(page + 1)}>次 →</button>
        </div>
      )}
    </div>
  );
}

// =============================================================================
const S = {
  wrap: { fontFamily: "'Noto Sans JP', system-ui, sans-serif", color: "#12151F",
          maxHeight: "calc(100vh - 120px)", overflowY: "auto", display: "flex", flexDirection: "column" },
  // 検索パネル
  searchPanel: { padding: "16px 20px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", flexShrink: 0 },
  searchTitle: { fontSize: 15, fontWeight: 700, marginBottom: 10 },
  searchGrid: { display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 10 },
  fieldGroup: { display: "flex", flexDirection: "column", gap: 3 },
  label: { fontSize: 10, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 },
  input: { padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 5,
           fontSize: 13, outline: "none", fontFamily: "inherit", background: "#fff" },
  select: { padding: "7px 8px", border: "1px solid #d1d5db", borderRadius: 5,
            fontSize: 12, background: "#fff", cursor: "pointer", fontFamily: "inherit" },
  searchActions: { display: "flex", gap: 8, marginTop: 10, alignItems: "center" },
  primaryBtn: { padding: "7px 24px", background: "#4f46e5", color: "#fff", border: "none",
                borderRadius: 5, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  secondaryBtn: { padding: "7px 16px", background: "#fff", color: "#475569", border: "1px solid #d1d5db",
                  borderRadius: 5, fontSize: 12, cursor: "pointer" },
  resultCount: { marginLeft: "auto", fontSize: 13, fontWeight: 700, color: "#4f46e5" },
  // 結果エリア
  resultArea: { flex: 1, overflowY: "auto", padding: "8px 20px" },
  empty: { padding: 60, textAlign: "center", color: "#94a3b8", fontSize: 14 },
  // カード
  card: { borderBottom: "1px solid #e5e7eb", marginBottom: 2 },
  cardHeader: { padding: "10px 12px", cursor: "pointer", borderRadius: 4, transition: "background .1s" },
  cardTitleRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  cardTitle: { fontSize: 13, fontWeight: 600, lineHeight: 1.5, color: "#1e293b", flex: 1 },
  expandIcon: { fontSize: 10, color: "#94a3b8", marginTop: 3, flexShrink: 0 },
  cardMeta: { display: "flex", gap: 6, marginTop: 5, alignItems: "center", flexWrap: "wrap", fontSize: 11 },
  badge: { padding: "1px 6px", background: "#eef2ff", color: "#4f46e5", borderRadius: 3, fontWeight: 700, fontSize: 10 },
  badgeCompany: { padding: "1px 6px", background: "#f0fdf4", color: "#166534", borderRadius: 3, fontWeight: 600, fontSize: 10 },
  badgeType: { padding: "1px 6px", background: "#f1f5f9", color: "#64748b", borderRadius: 3, fontSize: 10 },
  badgeOA: { padding: "1px 6px", background: "#ecfdf5", color: "#059669", borderRadius: 3, fontWeight: 700, fontSize: 10 },
  citedCount: { color: "#6b7280", fontFamily: "'JetBrains Mono', monospace", fontSize: 11 },
  sourceName: { color: "#94a3b8", maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  topicRow: { display: "flex", gap: 4, marginTop: 5, flexWrap: "wrap" },
  topicTag: { fontSize: 9, padding: "1px 7px", background: "#f1f5f9", borderRadius: 10, color: "#475569" },
  // カード展開時
  cardBody: { padding: "0 12px 14px", borderTop: "1px solid #f1f5f9" },
  linkRow: { display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" },
  oaBtn: { padding: "6px 14px", background: "#059669", color: "#fff", borderRadius: 5,
           fontSize: 12, fontWeight: 600, textDecoration: "none", display: "inline-block" },
  doiBtn: { padding: "6px 14px", background: "#fff", color: "#4f46e5", border: "1px solid #c7d2fe",
            borderRadius: 5, fontSize: 11, textDecoration: "none", display: "inline-block" },
  oaLinkBtn: { padding: "6px 14px", background: "#fff", color: "#64748b", border: "1px solid #d1d5db",
               borderRadius: 5, fontSize: 11, textDecoration: "none", display: "inline-block" },
  abstractBox: { marginTop: 12, padding: "12px 14px", background: "#fff", borderRadius: 6, border: "1px solid #e5e7eb" },
  sectionLabel: { fontSize: 10, fontWeight: 700, color: "#94a3b8", marginBottom: 6,
                  textTransform: "uppercase", letterSpacing: 1 },
  abstractText: { fontSize: 12.5, lineHeight: 1.8, color: "#334155" },
  statsRow: { display: "flex", gap: 16, marginTop: 14 },
  statBox: { display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 12px",
             background: "#f8fafc", borderRadius: 6, minWidth: 70 },
  statNum: { fontSize: 16, fontWeight: 700, color: "#1e293b", fontFamily: "'JetBrains Mono', monospace" },
  statLabel: { fontSize: 9, color: "#94a3b8", marginTop: 2 },
  topicDetail: { marginTop: 12 },
  topicDetailRow: { display: "flex", justifyContent: "space-between", padding: "4px 0",
                    borderBottom: "1px solid #f1f5f9", fontSize: 11, gap: 12 },
  topicDetailName: { fontWeight: 600, color: "#1e293b" },
  topicDetailField: { color: "#94a3b8", fontSize: 10, textAlign: "right" },
  // ページネーション
  pagination: { display: "flex", justifyContent: "center", alignItems: "center", gap: 16,
                padding: "12px 0", borderTop: "1px solid #e5e7eb", flexShrink: 0 },
  pageBtn: { padding: "6px 16px", border: "1px solid #d1d5db", borderRadius: 5, background: "#fff",
             cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit" },
  pageInfo: { fontSize: 12, color: "#64748b" },
};

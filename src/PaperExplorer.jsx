import { useState, useEffect, useMemo, useCallback } from "react";

// =============================================================================
// PaperExplorer — 論文検索・閲覧ダッシュボード
// =============================================================================

export default function PaperExplorer({ supabaseUrl, supabaseKey }) {
  // ---- データ ----
  const [companies, setCompanies] = useState([]);
  const [results, setResults]     = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading]     = useState(false);
  const [detail, setDetail]       = useState(null);

  // ---- 検索条件 ----
  const [keyword, setKeyword]       = useState("");
  const [companySlug, setCompanySlug] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [sortBy, setSortBy]         = useState("cited_by_count");
  const [page, setPage]             = useState(0);
  const PAGE_SIZE = 30;

  // ---- 企業一覧取得 ----
  useEffect(() => {
    fetch(`${supabaseUrl}/rest/v1/companies?select=id,name,group_id&order=group_id,name&limit=100`, {
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }
    }).then(r => r.json()).then(d => setCompanies(Array.isArray(d) ? d : []));
  }, []);

  const GROUP_LABELS = { group_west: "欧米", group_china: "中国", group_japan: "日本", group_beauty: "化粧品" };

  // ---- 検索実行 ----
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

    const orderCol = sortBy === "year" ? "publication_year.desc" : "cited_by_count.desc";
    const offset = newPage * PAGE_SIZE;

    const queryStr = [
      "select=openalex_id,doi,title,publication_year,cited_by_count,is_oa,source_name,type,company_slug,topics",
      ...filters,
      `order=${orderCol}`,
      `limit=${PAGE_SIZE}`,
      `offset=${offset}`,
    ].join("&");

    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/papers_search?${queryStr}`, {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Accept-Profile": "openalex",
          Prefer: "count=estimated",
        }
      });
      const countHeader = res.headers.get("content-range");
      if (countHeader) {
        const m = countHeader.match(/\/(\d+)/);
        if (m) setTotalCount(parseInt(m[1]));
      }
      const data = await res.json();
      setResults(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setResults([]);
    }
    setLoading(false);
  }, [keyword, companySlug, yearFilter, sortBy, supabaseUrl, supabaseKey]);

  // ---- 詳細取得 ----
  const loadDetail = async (id) => {
    if (detail?.openalex_id === id) { setDetail(null); return; }
    const res = await fetch(
      `${supabaseUrl}/rest/v1/works?openalex_id=eq.${id}&select=*`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Accept-Profile": "openalex" }}
    );
    const data = await res.json();
    if (Array.isArray(data) && data[0]) setDetail(data[0]);
  };

  // ---- トピック解析 ----
  const parseTopics = (topicsRaw) => {
    if (!topicsRaw) return [];
    try {
      const parsed = typeof topicsRaw === "string" ? JSON.parse(topicsRaw) : topicsRaw;
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  };

  // ---- 企業名引き ----
  const coMap = useMemo(() => Object.fromEntries(companies.map(c => [c.id, c])), [companies]);
  const coName = (slug) => coMap[slug]?.name || slug;

  // ---- 初回検索 ----
  useEffect(() => { doSearch(0); }, []);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div style={S.wrap}>
      {/* 検索バー */}
      <div style={S.searchBar}>
        <div style={S.searchRow}>
          <input
            style={S.input}
            type="text"
            placeholder="キーワードで論文を検索（英語）..."
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            onKeyDown={e => e.key === "Enter" && doSearch(0)}
          />
          <button style={S.searchBtn} onClick={() => doSearch(0)}>検索</button>
        </div>
        <div style={S.filterRow}>
          <select style={S.select} value={companySlug} onChange={e => { setCompanySlug(e.target.value); }}>
            <option value="">全企業</option>
            {Object.entries(GROUP_LABELS).map(([gid, label]) => (
              <optgroup key={gid} label={label}>
                {companies.filter(c => c.group_id === gid).map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <select style={S.select} value={yearFilter} onChange={e => { setYearFilter(e.target.value); }}>
            <option value="">全年</option>
            {[2026, 2025, 2024, 2023, 2022].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select style={S.select} value={sortBy} onChange={e => { setSortBy(e.target.value); }}>
            <option value="cited_by_count">被引用数順</option>
            <option value="year">新着順</option>
          </select>
          <span style={S.countLabel}>
            {loading ? "検索中..." : `${totalCount.toLocaleString()} 件`}
          </span>
        </div>
      </div>

      {/* 検索結果 */}
      <div style={S.resultsList}>
        {results.length === 0 && !loading && (
          <div style={S.empty}>検索条件に一致する論文がありません</div>
        )}
        {results.map((r, idx) => {
          const topics = parseTopics(r.topics);
          const isSelected = detail?.openalex_id === r.openalex_id;
          return (
            <div key={r.openalex_id + "_" + idx}>
              <div
                style={{...S.resultItem, ...(isSelected ? S.resultSelected : {})}}
                onClick={() => loadDetail(r.openalex_id)}
              >
                <div style={S.resultHeader}>
                  <span style={S.resultYear}>{r.publication_year}</span>
                  <span style={S.resultType}>{r.type || "article"}</span>
                  {r.is_oa && <span style={S.oaBadge}>OA</span>}
                  <span style={S.resultCited}>被引用 {(r.cited_by_count || 0).toLocaleString()}</span>
                </div>
                <div style={S.resultTitle}>{r.title || "(タイトルなし)"}</div>
                <div style={S.resultMeta}>
                  <span style={S.resultCompany}>{coName(r.company_slug)}</span>
                  {r.source_name && <span style={S.resultSource}>📄 {r.source_name}</span>}
                </div>
                {topics.length > 0 && (
                  <div style={S.topicRow}>
                    {topics.slice(0, 3).map((t, i) => (
                      <span key={i} style={S.topicTag}>{t.display_name || t.field}</span>
                    ))}
                  </div>
                )}
              </div>

              {/* 詳細パネル */}
              {isSelected && detail && (
                <div style={S.detailPanel}>
                  <h3 style={S.detailTitle}>{detail.title}</h3>
                  {detail.doi && (
                    <div style={S.detailDoi}>
                      DOI: <a href={`https://doi.org/${detail.doi}`} target="_blank" rel="noreferrer"
                              style={S.link}>{detail.doi}</a>
                    </div>
                  )}
                  <div style={S.detailDoi}>
                    OpenAlex: <a href={`https://openalex.org/${detail.openalex_id}`} target="_blank" rel="noreferrer"
                                 style={S.link}>{detail.openalex_id}</a>
                  </div>
                  {detail.abstract_text && (
                    <div style={S.abstractBox}>
                      <div style={S.abstractLabel}>Abstract</div>
                      <div style={S.abstractText}>{detail.abstract_text}</div>
                    </div>
                  )}
                  <div style={S.detailStats}>
                    <div style={S.statItem}><span style={S.statNum}>{(detail.cited_by_count || 0).toLocaleString()}</span><span style={S.statLabel}>被引用</span></div>
                    <div style={S.statItem}><span style={S.statNum}>{detail.publication_year}</span><span style={S.statLabel}>発行年</span></div>
                    <div style={S.statItem}><span style={S.statNum}>{detail.is_oa ? "Yes" : "No"}</span><span style={S.statLabel}>OA</span></div>
                    <div style={S.statItem}><span style={S.statNum}>{detail.type || "—"}</span><span style={S.statLabel}>種別</span></div>
                  </div>
                  {detail.source_name && (
                    <div style={S.detailSource}>掲載: {detail.source_name} ({detail.source_type})</div>
                  )}
                  {(() => {
                    const ts = parseTopics(detail.topics);
                    return ts.length > 0 && (
                      <div style={S.detailTopics}>
                        <div style={S.abstractLabel}>Topics</div>
                        {ts.map((t, i) => (
                          <div key={i} style={S.topicDetail}>
                            <span style={S.topicName}>{t.display_name}</span>
                            <span style={S.topicField}>{t.field} › {t.subfield}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ページネーション */}
      {totalPages > 1 && (
        <div style={S.pagination}>
          <button style={S.pageBtn} disabled={page === 0} onClick={() => doSearch(page - 1)}>← 前</button>
          <span style={S.pageInfo}>{page + 1} / {totalPages}</span>
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
  searchBar: { padding: "16px", borderBottom: "1px solid #e5e7eb", flexShrink: 0 },
  searchRow: { display: "flex", gap: 8 },
  input: { flex: 1, padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6,
           fontSize: 14, outline: "none", fontFamily: "inherit" },
  searchBtn: { padding: "8px 20px", background: "#4f46e5", color: "#fff", border: "none",
               borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  filterRow: { display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" },
  select: { padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 12,
            background: "#fff", cursor: "pointer", fontFamily: "inherit" },
  countLabel: { fontSize: 12, color: "#64748b", fontWeight: 600, marginLeft: "auto" },
  resultsList: { flex: 1, overflowY: "auto", padding: "0 16px" },
  empty: { padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 14 },
  resultItem: { padding: "12px 14px", borderBottom: "1px solid #f1f5f9", cursor: "pointer",
                transition: "background .1s", borderRadius: 4, marginTop: 2 },
  resultSelected: { background: "#f0f9ff", borderColor: "#bfdbfe" },
  resultHeader: { display: "flex", alignItems: "center", gap: 8, marginBottom: 4 },
  resultYear: { fontSize: 11, fontWeight: 700, color: "#4f46e5", background: "#eef2ff",
                padding: "2px 6px", borderRadius: 3 },
  resultType: { fontSize: 10, color: "#64748b", background: "#f1f5f9", padding: "2px 6px", borderRadius: 3 },
  oaBadge: { fontSize: 10, fontWeight: 700, color: "#059669", background: "#ecfdf5",
             padding: "2px 6px", borderRadius: 3 },
  resultCited: { fontSize: 11, color: "#6b7280", marginLeft: "auto", fontFamily: "'JetBrains Mono', monospace" },
  resultTitle: { fontSize: 13, fontWeight: 600, lineHeight: 1.4, color: "#1e293b" },
  resultMeta: { display: "flex", gap: 12, marginTop: 4, fontSize: 11, color: "#64748b" },
  resultCompany: { fontWeight: 600, color: "#475569" },
  resultSource: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 300 },
  topicRow: { display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" },
  topicTag: { fontSize: 10, padding: "2px 8px", background: "#f1f5f9", borderRadius: 10,
              color: "#475569", whiteSpace: "nowrap" },
  // 詳細パネル
  detailPanel: { padding: "16px 20px", background: "#f8fafc", borderRadius: 8,
                 border: "1px solid #e2e8f0", margin: "4px 0 8px" },
  detailTitle: { margin: "0 0 8px", fontSize: 16, fontWeight: 700, lineHeight: 1.4 },
  detailDoi: { fontSize: 12, color: "#64748b", marginBottom: 4 },
  link: { color: "#4f46e5", textDecoration: "none" },
  abstractBox: { marginTop: 12, padding: 12, background: "#fff", borderRadius: 6, border: "1px solid #e5e7eb" },
  abstractLabel: { fontSize: 11, fontWeight: 700, color: "#94a3b8", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 },
  abstractText: { fontSize: 13, lineHeight: 1.7, color: "#334155" },
  detailStats: { display: "flex", gap: 20, marginTop: 14 },
  statItem: { display: "flex", flexDirection: "column", alignItems: "center" },
  statNum: { fontSize: 18, fontWeight: 700, color: "#1e293b", fontFamily: "'JetBrains Mono', monospace" },
  statLabel: { fontSize: 10, color: "#94a3b8", marginTop: 2 },
  detailSource: { marginTop: 10, fontSize: 12, color: "#64748b" },
  detailTopics: { marginTop: 12 },
  topicDetail: { display: "flex", justifyContent: "space-between", padding: "4px 0",
                 borderBottom: "1px solid #f1f5f9", fontSize: 12 },
  topicName: { fontWeight: 600, color: "#1e293b" },
  topicField: { color: "#94a3b8", fontSize: 11 },
  // ページネーション
  pagination: { display: "flex", justifyContent: "center", alignItems: "center", gap: 16,
                padding: "12px 0", borderTop: "1px solid #e5e7eb", flexShrink: 0 },
  pageBtn: { padding: "6px 16px", border: "1px solid #d1d5db", borderRadius: 6, background: "#fff",
             cursor: "pointer", fontSize: 12, fontWeight: 600 },
  pageInfo: { fontSize: 12, color: "#64748b" },
};

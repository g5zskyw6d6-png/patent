import { useState, useCallback, useEffect } from "react";

/**
 * PatentListModal.jsx
 * 技術ポートフォリオから呼び出されるモーダル
 * 企業 × カテゴリでフィルタされた特許一覧を表示
 */
export default function PatentListModal({
  filterForModal,      // { company_id, company_name, category_id, category_name, level }
  onClose,
  sbRpc,
  supabaseUrl,
  supabaseKey,
  companies,
  taxonomy,
  taxByCode,           // 大分類コード → 分類オブジェクトの map
  c,                   // CommonStyles
  card                 // Card styles
}) {
  const [results, setResults] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(0);

  const PAGE_SIZE = 15;

  // 初期化確認ログ
  useEffect(() => {
    console.log("🟢 PatentListModal mounted!", {
      company: filterForModal?.company_name,
      category: filterForModal?.category_name,
      category_id: filterForModal?.category_id,
      level: filterForModal?.level,
      sbRpc: sbRpc ? "✓" : "✗ MISSING",
    });
  }, [filterForModal, sbRpc]);

  // カテゴリのキーワードを構築（大分類の場合は親も含める）
  const getCategoryKeywords = useCallback(() => {
    if (!filterForModal.category_name) return [];
    const keywords = [];
    // メインのカテゴリ名
    keywords.push(filterForModal.category_name);

    // 小分類の場合は親分類も含める
    if (filterForModal.level === "drill" && taxonomy) {
      const taxItem = taxonomy.find(t => t.id === filterForModal.category_id);
      if (taxItem?.parent_id) {
        const parent = taxonomy.find(t => t.id === taxItem.parent_id);
        if (parent) keywords.push(parent.name_ja);
      }
    }

    return keywords;
  }, [filterForModal, taxonomy]);

  // Supabase から patents を直接クエリ（カテゴリフィルタに対応）
  const doSearch = useCallback(async (pg = 0) => {
    setLoading(true);
    setError("");
    try {
      const offset = pg * PAGE_SIZE;

      // REST API で直接クエリ（search_patents RPC の制限を回避）
      const headers = {
        "apikey": supabaseKey,
        "Authorization": "Bearer " + supabaseKey,
        "Accept": "application/json",
      };

      // ① 企業 × カテゴリのマッチングキーワードで検索
      const catKeywords = getCategoryKeywords();
      const userKeyword = keyword.trim();

      // URL 構築：複数キーワードのOR条件を1つの or=() にまとめる
      let url = `${supabaseUrl}/rest/v1/patents?select=patent_number,title_ja,title_en,publication_date,country,company_id,company_name`;

      // 企業フィルタ（必須）
      url += `&company_id=eq.${filterForModal.company_id}`;

      // カテゴリキーワード + ユーザーキーワードの全ORフィルタを構築
      const allKeywords = [...catKeywords, ...(userKeyword ? [userKeyword] : [])];
      if (allKeywords.length > 0) {
        const orConditions = allKeywords.flatMap(kw => {
          const encoded = encodeURIComponent(kw);
          return [
            `title_ja.ilike.*${encoded}*`,
            `title_en.ilike.*${encoded}*`,
            `abstract_epo.ilike.*${encoded}*`
          ];
        });
        // 全条件を1つの or=(...) にまとめる（重要：複数の or= パラメータは使わない）
        url += `&or=(${orConditions.join(",")})`;
      }

      // ソート、ページネーション、正確な件数取得
      url += `&order=publication_date.desc&limit=${PAGE_SIZE}&offset=${offset}&count=exact`;

      console.log("📊 Query URL:", url.substring(0, 150) + "...");

      // ② データ取得
      let res;
      try {
        res = await fetch(url, { headers });
      } catch (fetchErr) {
        console.error("❌ Fetch failed:", fetchErr.message);
        throw fetchErr;
      }

      console.log("📊 Response Status:", res.status, "OK:", res.ok);

      if (!res.ok) {
        let errText = "";
        try {
          errText = await res.text();
        } catch (e) {
          errText = "Could not read error body";
        }
        console.error("❌ API Error Response:", {
          status: res.status,
          statusText: res.statusText,
          body: errText.substring(0, 200),
        });
        throw new Error(`REST API failed: ${res.status}`);
      }

      let data = [];
      try {
        data = await res.json();
      } catch (jsonErr) {
        console.error("❌ JSON parse failed:", jsonErr.message);
        throw jsonErr;
      }

      const contentRange = res.headers.get('content-range');

      console.log("📊 API Response Success:", {
        status: res.status,
        contentRange: contentRange,
        dataLength: data?.length || 0,
      });

      // 合計件数を取得
      // content-range は "0-14/1234" の形式
      let totalCount = 0;
      if (contentRange) {
        const parts = contentRange.split('/');
        if (parts.length === 2) {
          totalCount = parseInt(parts[1], 10);
        }
      }

      // totalCount が NaN の場合はデータ長を使用
      if (isNaN(totalCount) || totalCount === 0) {
        totalCount = data?.length || 0;
      }

      console.log("📊 PatentListModal direct query result:", {
        category: filterForModal.category_name,
        company: filterForModal.company_name,
        totalCount,
        pageSize: data?.length || 0,
        offset,
      });

      setResults(data || []);
      setTotalCount(totalCount);
    } catch (e) {
      console.error("❌ PatentListModal query error:", {
        message: e.message,
        stack: e.stack?.substring(0, 200),
      });
      setError(e.message);
      setResults([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [keyword, filterForModal.company_id, filterForModal.category_name, filterForModal.level, filterForModal.category_id, getCategoryKeywords, supabaseUrl, supabaseKey, PAGE_SIZE, taxonomy]);

  // ページ変更時に検索
  useEffect(() => {
    doSearch(page);
  }, [page, doSearch]);

  // キーワード変更時はページ 0 にリセット
  const handleKeywordChange = (e) => {
    setKeyword(e.target.value);
    setPage(0);
  };

  const handleSearch = () => {
    setPage(0);
    doSearch(0);
  };

  // CSV ダウンロード（全件取得版）
  const exportCsv = async () => {
    try {
      setLoading(true);
      const allPatents = [];
      let offset = 0;
      const BATCH = 1000;

      const headers = {
        "apikey": supabaseKey,
        "Authorization": "Bearer " + supabaseKey,
        "Accept": "application/json",
      };

      const catKeywords = getCategoryKeywords();
      const userKeyword = keyword.trim();

      // URL 構築（doSearch と同じロジック）
      let baseUrl = `${supabaseUrl}/rest/v1/patents?select=patent_number,title_ja,title_en,publication_date,country`;

      // 企業フィルタ
      baseUrl += `&company_id=eq.${filterForModal.company_id}`;

      // カテゴリキーワード + ユーザーキーワードの全ORフィルタ
      const allKeywords = [...catKeywords, ...(userKeyword ? [userKeyword] : [])];
      if (allKeywords.length > 0) {
        const orConditions = allKeywords.flatMap(kw => {
          const encoded = encodeURIComponent(kw);
          return [
            `title_ja.ilike.*${encoded}*`,
            `title_en.ilike.*${encoded}*`,
            `abstract_epo.ilike.*${encoded}*`
          ];
        });
        // 全条件を1つの or=(...) にまとめる
        baseUrl += `&or=(${orConditions.join(",")})`;
      }

      baseUrl += `&order=publication_date.desc`;

      // バッチで全件取得
      while (true) {
        const url = `${baseUrl}&limit=${BATCH}&offset=${offset}&count=exact`;
        const res = await fetch(url, { headers });

        if (!res.ok) break;

        const batch = await res.json();
        if (!batch || batch.length === 0) break;

        allPatents.push(...batch);
        offset += BATCH;
      }

      // CSV 生成
      const csv = [
        ["Patent Number", "Title", "Publication Date", "Country", "Company"].join(","),
        ...allPatents.map(p =>
          [
            `"${p.patent_number || ""}"`,
            `"${(p.title_ja || p.title_en || "").replace(/"/g, '""')}"`,
            p.publication_date || "",
            p.country || "",
            filterForModal.company_name,
          ].join(",")
        ),
      ].join("\n");

      // ダウンロード
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `patents_${filterForModal.company_id}_${filterForModal.category_id}_${Date.now()}.csv`);
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e) {
      setError("CSV 出力に失敗しました：" + e.message);
    } finally {
      setLoading(false);
    }
  };

  const S = MODAL_STYLES;
  const maxPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        {/* ヘッダー */}
        <div style={S.header}>
          <div style={S.headerTitle}>
            <span style={S.closeBtn} onClick={onClose}>✕</span>
            <div>
              <div style={S.modalTitle}>
                {filterForModal.company_name} × {filterForModal.category_name}
              </div>
              <div style={S.modalSubtitle}>
                特許一覧 ({totalCount} 件)
              </div>
            </div>
          </div>
        </div>

        {/* コントロール */}
        <div style={S.controls}>
          <input
            type="text"
            id="patentKeywordSearch"
            name="patentKeywordSearch"
            placeholder="キーワードで絞り込み（オプション）"
            value={keyword}
            onChange={handleKeywordChange}
            onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
            style={S.input}
            disabled={loading}
          />
          <button onClick={handleSearch} style={S.searchBtn} disabled={loading}>
            {loading ? "検索中…" : "検索"}
          </button>
          <button onClick={exportCsv} style={S.csvBtn} disabled={loading}>
            📥 CSV
          </button>
        </div>

        {/* エラー */}
        {error && <div style={S.error}>{error}</div>}

        {/* 結果テーブル */}
        <div style={S.tableWrap}>
          {loading ? (
            <div style={S.loadingMsg}>読み込み中…</div>
          ) : results.length === 0 ? (
            <div style={S.emptyMsg}>該当する特許がありません</div>
          ) : (
            <table style={S.table}>
              <thead>
                <tr style={S.headerRow}>
                  <th style={{ ...S.th, flex: "0 0 100px" }}>Patent No.</th>
                  <th style={{ ...S.th, flex: "1" }}>Title</th>
                  <th style={{ ...S.th, flex: "0 0 100px" }}>Date</th>
                  <th style={{ ...S.th, flex: "0 0 60px" }}>Country</th>
                </tr>
              </thead>
              <tbody>
                {results.map((p, i) => (
                  <tr key={i} style={S.row}>
                    <td style={{ ...S.td, flex: "0 0 100px", fontFamily: "monospace", fontSize: 11 }}>
                      {p.patent_number}
                    </td>
                    <td style={{ ...S.td, flex: "1" }}>
                      <div style={S.titleCell}>
                        {p.title_ja || p.title_en || "（タイトルなし）"}
                      </div>
                    </td>
                    <td style={{ ...S.td, flex: "0 0 100px", fontSize: 11 }}>
                      {p.publication_date}
                    </td>
                    <td style={{ ...S.td, flex: "0 0 60px", fontSize: 11, textAlign: "center" }}>
                      {p.country}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ページネーション */}
        {maxPages > 1 && (
          <div style={S.pagination}>
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0 || loading}
              style={S.pageBtn}
            >
              ← 前へ
            </button>
            <span style={S.pageInfo}>
              {page + 1} / {maxPages}
            </span>
            <button
              onClick={() => setPage(Math.min(maxPages - 1, page + 1))}
              disabled={page >= maxPages - 1 || loading}
              style={S.pageBtn}
            >
              次へ →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ===== スタイル =====
const MODAL_STYLES = {
  overlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: "rgba(0,0,0,0.4)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  modal: {
    background: "#fff",
    borderRadius: 12,
    boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
    width: "90%",
    maxWidth: "900px",
    maxHeight: "80vh",
    display: "flex",
    flexDirection: "column",
    fontFamily: "'Noto Sans JP', system-ui, sans-serif",
  },
  header: {
    padding: "20px 24px",
    borderBottom: "1px solid #E4E7EE",
  },
  headerTitle: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    position: "relative",
  },
  closeBtn: {
    position: "absolute",
    right: 0,
    top: 0,
    fontSize: 20,
    cursor: "pointer",
    color: "#9AA1B0",
    background: "none",
    border: "none",
    padding: 0,
    width: 24,
    height: 24,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 4,
    ":hover": { background: "#F5F6F9" },
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: "#12151F",
  },
  modalSubtitle: {
    fontSize: 12,
    color: "#9AA1B0",
    marginTop: 4,
  },
  controls: {
    display: "flex",
    gap: 10,
    padding: "16px 24px",
    borderBottom: "1px solid #F5F6F9",
    alignItems: "center",
  },
  input: {
    flex: 1,
    padding: "8px 12px",
    border: "1px solid #CFD4DF",
    borderRadius: 6,
    fontSize: 13,
    fontFamily: "inherit",
  },
  searchBtn: {
    padding: "8px 16px",
    background: "#3B4EE0",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
  },
  csvBtn: {
    padding: "8px 16px",
    background: "#F5F6F9",
    color: "#5A6274",
    border: "1px solid #CFD4DF",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
  },
  error: {
    padding: "12px 24px",
    background: "#FEE2E2",
    color: "#C94F71",
    fontSize: 12,
    borderBottom: "1px solid #FECACA",
  },
  tableWrap: {
    flex: 1,
    overflowY: "auto",
    padding: "16px 24px",
  },
  loadingMsg: {
    textAlign: "center",
    color: "#9AA1B0",
    padding: "40px 20px",
    fontSize: 14,
  },
  emptyMsg: {
    textAlign: "center",
    color: "#9AA1B0",
    padding: "40px 20px",
    fontSize: 14,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
  },
  headerRow: {
    borderBottom: "2px solid #E4E7EE",
  },
  th: {
    padding: "10px 8px",
    textAlign: "left",
    fontSize: 12,
    fontWeight: 600,
    color: "#475569",
    verticalAlign: "middle",
  },
  row: {
    borderBottom: "1px solid #F5F6F9",
    display: "flex",
  },
  td: {
    padding: "10px 8px",
    fontSize: 12,
    color: "#12151F",
    display: "flex",
    alignItems: "center",
  },
  titleCell: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    lineHeight: 1.4,
  },
  pagination: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    padding: "16px 24px",
    borderTop: "1px solid #F5F6F9",
  },
  pageBtn: {
    padding: "6px 12px",
    background: "#F5F6F9",
    color: "#5A6274",
    border: "1px solid #CFD4DF",
    borderRadius: 4,
    cursor: "pointer",
    fontSize: 12,
  },
  pageInfo: {
    fontSize: 12,
    color: "#9AA1B0",
    minWidth: 60,
    textAlign: "center",
  },
};

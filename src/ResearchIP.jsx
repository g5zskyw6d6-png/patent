import { useState, useEffect, useMemo, useCallback } from "react";

// =============================================================================
// ResearchIP — 研究→IP転換分析ダッシュボード
// =============================================================================
// 特許(tech_signals_patent) と 論文(tech_signals_paper) を同じ企業×カテゴリ軸で
// 並べ、ヒートマップ + IP転換率で比較する。TechPortfolio と同じ操作感。
// =============================================================================

export default function ResearchIP({ supabaseUrl, supabaseKey }) {
  // ---- データ ----
  const [taxonomy, setTaxonomy] = useState([]);
  const [patents, setPatents]   = useState([]);
  const [papers, setPapers]     = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading]   = useState(true);

  // ---- UI状態 ----
  const [mode, setMode]           = useState("patents");   // patents / papers / ratio
  const [yearMode, setYearMode]   = useState("all");       // all / 2024 / 2025
  const [groupFilter, setGroupFilter] = useState("all");   // all / group_west / ...
  const [selected, setSelected]   = useState(null);

  // ---- フェッチ ----
  const sbGetInt = (path) => fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Accept-Profile": "integration" }
  }).then(r => r.json());

  const sbGetPub = (path) => fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }
  }).then(r => r.json());

  useEffect(() => {
    setLoading(true);
    Promise.all([
      sbGetInt("technology_taxonomy?select=id,code,name_ja,parent_id,level,sort_order&order=sort_order&limit=100000"),
      sbGetInt("tech_signals_patent?select=canonical_slug,taxonomy_id,year,patent_count&limit=100000"),
      sbGetInt("tech_signals_paper?select=canonical_slug,taxonomy_code,year,paper_count&limit=100000"),
      sbGetPub("companies?select=id,name,group_id&limit=100000"),
    ]).then(([tax, pat, pap, cos]) => {
      setTaxonomy(Array.isArray(tax) ? tax : []);
      setPatents(Array.isArray(pat) ? pat : []);
      setPapers(Array.isArray(pap) ? pap : []);
      setCompanies(Array.isArray(cos) ? cos : []);
      setLoading(false);
    }).catch(e => { console.error(e); setLoading(false); });
  }, []);

  // ---- 分類(大分類のみ) ----
  const categories = useMemo(() =>
    taxonomy.filter(t => t.level === 1).sort((a,b) => a.sort_order - b.sort_order),
    [taxonomy]
  );
  const catById = useMemo(() => Object.fromEntries(taxonomy.map(t => [t.id, t])), [taxonomy]);

  // ---- 企業ヘルパー ----
  const coMap = useMemo(() => Object.fromEntries(companies.map(c => [c.id, c])), [companies]);
  const coName  = useCallback(slug => coMap[slug]?.name || slug, [coMap]);
  const coGroup = useCallback(slug => coMap[slug]?.group_id || "", [coMap]);

  const GROUP_ORDER = { group_west: 0, group_china: 1, group_japan: 2, group_beauty: 3 };
  const GROUP_LABELS = { group_west: "欧米", group_china: "中国", group_japan: "日本", group_beauty: "化粧品" };
  const groupOrder = useCallback(slug => GROUP_ORDER[coGroup(slug)] ?? 9, [coGroup]);

  // ---- キューブ構築 ----
  // patents: canonical_slug × taxonomy_id(int) × year → patent_count
  const patCube = useMemo(() => {
    const c = {};
    for (const r of patents) {
      const cat = catById[r.taxonomy_id];
      if (!cat || cat.level !== 1) continue;
      const key = `${r.canonical_slug}|${cat.code}`;
      if (!c[key]) c[key] = { slug: r.canonical_slug, code: cat.code, all: 0 };
      c[key][r.year] = (c[key][r.year] || 0) + r.patent_count;
      c[key].all += r.patent_count;
    }
    return c;
  }, [patents, catById]);

  // papers: canonical_slug × taxonomy_code(text) × year → paper_count
  const papCube = useMemo(() => {
    const c = {};
    for (const r of papers) {
      const key = `${r.canonical_slug}|${r.taxonomy_code}`;
      if (!c[key]) c[key] = { slug: r.canonical_slug, code: r.taxonomy_code, all: 0 };
      c[key][r.year] = (c[key][r.year] || 0) + r.paper_count;
      c[key].all += r.paper_count;
    }
    return c;
  }, [papers]);

  // ---- 値取得 ----
  const getVal = useCallback((slug, catCode, ym) => {
    const pk = `${slug}|${catCode}`;
    if (mode === "patents") return patCube[pk]?.[ym] || 0;
    if (mode === "papers")  return papCube[pk]?.[ym] || 0;
    // ratio
    const pat = patCube[pk]?.[ym] || 0;
    const pap = papCube[pk]?.[ym] || 0;
    return pap > 0 ? pat / pap : null;
  }, [mode, patCube, papCube]);

  // ---- 企業リスト ----
  const allSlugs = useMemo(() => {
    const set = new Set();
    patents.forEach(r => set.add(r.canonical_slug));
    papers.forEach(r => set.add(r.canonical_slug));
    return Array.from(set);
  }, [patents, papers]);

  const activeCompanies = useMemo(() =>
    allSlugs
      .filter(s => groupFilter === "all" || coGroup(s) === groupFilter)
      .sort((a,b) => groupOrder(a) - groupOrder(b) || coName(a).localeCompare(coName(b))),
    [allSlugs, groupFilter, coGroup, groupOrder, coName]
  );

  // ---- ヒートマップの最大値(色スケール用) ----
  const maxVal = useMemo(() => {
    if (mode === "ratio") return 5; // ratio は 0-5 でクリップ
    let mx = 0;
    for (const slug of activeCompanies) {
      for (const cat of categories) {
        const v = getVal(slug, cat.code, yearMode);
        if (v != null && v > mx) mx = v;
      }
    }
    return mx || 1;
  }, [activeCompanies, categories, getVal, yearMode, mode]);

  // ---- 色 ----
  const cellColor = useCallback((val) => {
    if (val == null || val === 0) return "transparent";
    if (mode === "ratio") {
      // 低い(研究先行)=青, 高い(IP重視)=赤, 1.0=白
      const clamped = Math.min(val, 5);
      if (clamped < 1) {
        const t = clamped; // 0→1
        const b = Math.round(220 - t * 120); // 220→100
        return `rgba(50, 80, ${b}, ${0.3 + t * 0.5})`;
      } else {
        const t = Math.min((clamped - 1) / 4, 1); // 1→5 mapped to 0→1
        const r = Math.round(180 + t * 75);
        return `rgba(${r}, 50, 50, ${0.3 + t * 0.5})`;
      }
    }
    // patents / papers: インディゴ系(sqrt スケール)
    const pct = Math.sqrt(val / maxVal);
    const base = mode === "papers" ? [30, 100, 180] : [55, 48, 163]; // 論文=青, 特許=インディゴ
    return `rgba(${base[0]}, ${base[1]}, ${base[2]}, ${0.08 + pct * 0.82})`;
  }, [mode, maxVal]);

  const fmtVal = (val) => {
    if (val == null) return "·";
    if (mode === "ratio") return val === 0 ? "0" : val < 0.01 ? "<.01" : val.toFixed(2);
    return val === 0 ? "·" : val.toLocaleString();
  };

  // ---- 行合計 ----
  const rowTotal = useCallback((slug) => {
    let sum = 0;
    for (const cat of categories) {
      const v = getVal(slug, cat.code, yearMode);
      if (v != null) sum += (mode === "ratio" ? 0 : v);
    }
    return mode === "ratio" ? null : sum;
  }, [categories, getVal, yearMode, mode]);

  // ---- 選択企業の詳細 ----
  const selectedDetail = useMemo(() => {
    if (!selected) return null;
    return categories.map(cat => {
      const pat = patCube[`${selected}|${cat.code}`]?.all || 0;
      const pap = papCube[`${selected}|${cat.code}`]?.all || 0;
      const ratio = pap > 0 ? (pat / pap).toFixed(3) : "—";
      return { name: cat.name_ja, patents: pat, papers: pap, ratio };
    });
  }, [selected, categories, patCube, papCube]);

  // ---- グループ区切り線 ----
  const groupBoundaries = useMemo(() => {
    const bounds = new Set();
    for (let i = 1; i < activeCompanies.length; i++) {
      if (coGroup(activeCompanies[i]) !== coGroup(activeCompanies[i-1])) bounds.add(i);
    }
    return bounds;
  }, [activeCompanies, coGroup]);

  if (loading) return <div style={S.loading}>読み込み中...</div>;

  return (
    <div style={S.wrap}>
      {/* ヘッダー */}
      <div style={S.header}>
        <h2 style={S.title}>研究→IP転換分析</h2>
        <div style={S.controls}>
          {/* モード */}
          <div style={S.toggleGroup}>
            {[["patents","特許"],["papers","論文"],["ratio","IP転換率"]].map(([k,l]) =>
              <button key={k} onClick={() => setMode(k)}
                style={{...S.toggle, ...(mode===k ? S.toggleActive : {}),
                  ...(k === "ratio" ? { minWidth: 90 } : {})}}>
                {l}
              </button>
            )}
          </div>
          {/* 年 */}
          <div style={S.toggleGroup}>
            {[["all","全年"],["2024","2024"],["2025","2025"]].map(([k,l]) =>
              <button key={k} onClick={() => setYearMode(k)}
                style={{...S.toggle, ...(yearMode===k ? S.toggleActive : {})}}>
                {l}
              </button>
            )}
          </div>
          {/* グループ */}
          <div style={S.toggleGroup}>
            {[["all","全体"],["group_west","欧米"],["group_china","中国"],["group_japan","日本"],["group_beauty","化粧品"]].map(([k,l]) =>
              <button key={k} onClick={() => setGroupFilter(k)}
                style={{...S.toggle, ...(groupFilter===k ? S.toggleActive : {})}}>
                {l}
              </button>
            )}
          </div>
        </div>
        {mode === "ratio" && (
          <div style={S.legend}>
            <span style={{...S.legendBox, background: "rgba(50,80,220,0.6)"}}/>研究先行(＜1)
            <span style={{...S.legendBox, background: "rgba(200,200,200,0.3)", marginLeft: 12}}/>均衡(≈1)
            <span style={{...S.legendBox, background: "rgba(220,50,50,0.6)", marginLeft: 12}}/>IP重視(＞1)
          </div>
        )}
      </div>

      {/* ヒートマップ */}
      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>企業</th>
              {categories.map(c => <th key={c.code} style={S.thCat}>{c.name_ja}</th>)}
              {mode !== "ratio" && <th style={S.thCat}>合計</th>}
            </tr>
          </thead>
          <tbody>
            {activeCompanies.map((slug, idx) => {
              const isGroupStart = groupBoundaries.has(idx);
              return (
                <tr key={slug}
                    onClick={() => setSelected(slug === selected ? null : slug)}
                    style={{
                      ...S.tr,
                      ...(slug === selected ? S.trSelected : {}),
                      ...(isGroupStart ? S.trGroupBorder : {}),
                      cursor: "pointer"
                    }}>
                  <td style={S.tdName}>
                    {isGroupStart && <span style={S.groupTag}>{GROUP_LABELS[coGroup(slug)]}</span>}
                    {coName(slug)}
                  </td>
                  {categories.map(cat => {
                    const val = getVal(slug, cat.code, yearMode);
                    return (
                      <td key={cat.code}
                          style={{...S.tdCell, background: cellColor(val)}}>
                        <span style={S.cellText}>{fmtVal(val)}</span>
                      </td>
                    );
                  })}
                  {mode !== "ratio" && (
                    <td style={S.tdTotal}>{(rowTotal(slug) || 0).toLocaleString()}</td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 選択企業の詳細パネル */}
      {selected && selectedDetail && (
        <div style={S.detail}>
          <h3 style={S.detailTitle}>{coName(selected)} — 特許 vs 論文</h3>
          <table style={S.detailTable}>
            <thead>
              <tr>
                <th style={S.dth}>カテゴリ</th>
                <th style={S.dthR}>特許</th>
                <th style={S.dthR}>論文</th>
                <th style={S.dthR}>IP転換率</th>
                <th style={S.dth}>判定</th>
              </tr>
            </thead>
            <tbody>
              {selectedDetail.map(d => {
                const r = parseFloat(d.ratio);
                const flag = isNaN(r) ? "—" : r < 0.3 ? "★研究先行" : r < 1 ? "◯転換途上" : r > 3 ? "●IP囲い込み" : "均衡";
                const flagColor = isNaN(r) ? "#999" : r < 0.3 ? "#2563eb" : r < 1 ? "#059669" : r > 3 ? "#dc2626" : "#6b7280";
                return (
                  <tr key={d.name}>
                    <td style={S.dtd}>{d.name}</td>
                    <td style={S.dtdR}>{d.patents.toLocaleString()}</td>
                    <td style={S.dtdR}>{d.papers.toLocaleString()}</td>
                    <td style={S.dtdR}>{d.ratio}</td>
                    <td style={{...S.dtd, color: flagColor, fontWeight: 600}}>{flag}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// スタイル
// =============================================================================
const S = {
  wrap: { fontFamily: "'Noto Sans JP', system-ui, sans-serif", color: "#12151F",
          maxHeight: "calc(100vh - 160px)", overflowY: "auto", paddingBottom: 40 },
  loading: { padding: 40, textAlign: "center", color: "#666" },
  header: { padding: "12px 16px", borderBottom: "1px solid #e5e7eb" },
  title: { margin: 0, fontSize: 18, fontWeight: 700 },
  controls: { display: "flex", gap: 12, marginTop: 10, flexWrap: "wrap" },
  toggleGroup: { display: "flex", gap: 2, background: "#f1f5f9", borderRadius: 6, padding: 2 },
  toggle: { border: "none", background: "transparent", padding: "5px 12px", borderRadius: 5,
            cursor: "pointer", fontSize: 12, color: "#475569", fontWeight: 500, whiteSpace: "nowrap" },
  toggleActive: { background: "#fff", color: "#1e293b", boxShadow: "0 1px 2px rgba(0,0,0,.1)", fontWeight: 700 },
  legend: { marginTop: 8, fontSize: 11, color: "#64748b", display: "flex", alignItems: "center", gap: 4 },
  legendBox: { display: "inline-block", width: 14, height: 14, borderRadius: 3 },
  tableWrap: { overflowX: "auto" },
  table: { borderCollapse: "collapse", width: "100%", fontSize: 11 },
  th: { padding: "8px 10px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#64748b",
        borderBottom: "2px solid #e2e8f0", whiteSpace: "nowrap", position: "sticky", top: 0, background: "#fff", zIndex: 2 },
  thCat: { padding: "6px 4px", textAlign: "center", fontSize: 10, fontWeight: 600, color: "#64748b",
           borderBottom: "2px solid #e2e8f0", whiteSpace: "nowrap", position: "sticky", top: 0, background: "#fff", zIndex: 2 },
  tr: { transition: "background .1s" },
  trSelected: { background: "#f0f9ff" },
  trGroupBorder: { borderTop: "2px solid #cbd5e1" },
  tdName: { padding: "4px 8px", whiteSpace: "nowrap", fontWeight: 500, fontSize: 11, borderBottom: "1px solid #f1f5f9",
            position: "sticky", left: 0, background: "#fff", zIndex: 1, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" },
  groupTag: { display: "block", fontSize: 9, color: "#94a3b8", fontWeight: 400, lineHeight: 1 },
  tdCell: { padding: "3px 2px", textAlign: "center", borderBottom: "1px solid #f8fafc", minWidth: 44, transition: "background .15s" },
  cellText: { fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.5)" },
  tdTotal: { padding: "3px 6px", textAlign: "right", borderBottom: "1px solid #f1f5f9", fontWeight: 600,
             fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: "#475569" },
  // 詳細パネル
  detail: { margin: "16px 16px 0", padding: 16, background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" },
  detailTitle: { margin: "0 0 12px", fontSize: 15, fontWeight: 700 },
  detailTable: { width: "100%", borderCollapse: "collapse", fontSize: 12 },
  dth:  { padding: "6px 8px", textAlign: "left", fontWeight: 600, color: "#475569", borderBottom: "2px solid #e2e8f0" },
  dthR: { padding: "6px 8px", textAlign: "right", fontWeight: 600, color: "#475569", borderBottom: "2px solid #e2e8f0" },
  dtd:  { padding: "5px 8px", borderBottom: "1px solid #e5e7eb" },
  dtdR: { padding: "5px 8px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace", borderBottom: "1px solid #e5e7eb" },
};

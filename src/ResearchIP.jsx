import { useState, useEffect, useMemo, useCallback } from "react";

// =============================================================================
// ResearchIP v2 — 研究→IP転換分析 + サブカテゴリドリルダウン
// =============================================================================

export default function ResearchIP({ supabaseUrl, supabaseKey }) {
  const [taxonomy, setTaxonomy] = useState([]);
  const [patTop, setPatTop]     = useState([]);  // tech_signals_patent
  const [papTop, setPapTop]     = useState([]);  // tech_signals_paper
  const [patSub, setPatSub]     = useState([]);  // tech_signals_subcat
  const [papSub, setPapSub]     = useState([]);  // tech_signals_paper_subcat
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading]   = useState(true);

  const [mode, setMode]           = useState("patents");
  const [yearMode, setYearMode]   = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [selected, setSelected]   = useState(null);
  const [drillCat, setDrillCat]   = useState(null); // ドリルダウン中のカテゴリcode

  const sbGet = (path, profile) => fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`,
               ...(profile ? { "Accept-Profile": profile } : {}) }
  }).then(r => r.json());

  useEffect(() => {
    setLoading(true);
    Promise.all([
      sbGet("technology_taxonomy?select=id,code,name_ja,parent_id,level,sort_order&order=sort_order&limit=100000", "integration"),
      sbGet("tech_signals_patent?select=canonical_slug,taxonomy_id,year,patent_count&limit=100000", "integration"),
      sbGet("tech_signals_paper?select=canonical_slug,taxonomy_code,year,paper_count&limit=100000", "integration"),
      sbGet("tech_signals_subcat?select=canonical_slug,taxonomy_id,year,patent_count&limit=100000", "integration"),
      sbGet("tech_signals_paper_subcat?select=canonical_slug,taxonomy_id,year,paper_count&limit=100000", "integration"),
      sbGet("companies?select=id,name,group_id&limit=100000"),
    ]).then(([tax, pt, pp, ps, pps, cos]) => {
      setTaxonomy(Array.isArray(tax) ? tax : []);
      setPatTop(Array.isArray(pt) ? pt : []);
      setPapTop(Array.isArray(pp) ? pp : []);
      setPatSub(Array.isArray(ps) ? ps : []);
      setPapSub(Array.isArray(pps) ? pps : []);
      setCompanies(Array.isArray(cos) ? cos : []);
      setLoading(false);
    }).catch(e => { console.error(e); setLoading(false); });
  }, []);

  // ---- 分類 ----
  const topCats = useMemo(() =>
    taxonomy.filter(t => t.level === 1).sort((a,b) => a.sort_order - b.sort_order), [taxonomy]);
  const taxById = useMemo(() => Object.fromEntries(taxonomy.map(t => [t.id, t])), [taxonomy]);
  const taxByCode = useMemo(() => Object.fromEntries(taxonomy.map(t => [t.code, t])), [taxonomy]);

  // サブカテゴリ(ドリルダウン中のカテゴリの子)
  const subCats = useMemo(() => {
    if (!drillCat) return [];
    const parent = taxByCode[drillCat];
    if (!parent) return [];
    return taxonomy.filter(t => t.parent_id === parent.id).sort((a,b) => a.sort_order - b.sort_order);
  }, [drillCat, taxonomy, taxByCode]);

  // 表示する列(大分類 or サブカテゴリ)
  const cols = drillCat ? subCats : topCats;

  // どのカテゴリにサブカテゴリがあるか(ドリルダウン可能マーク用)
  const drillable = useMemo(() => {
    const set = new Set();
    taxonomy.filter(t => t.level === 2).forEach(t => {
      const p = taxById[t.parent_id];
      if (p) set.add(p.code);
    });
    return set;
  }, [taxonomy, taxById]);

  // ---- 企業 ----
  const coMap = useMemo(() => Object.fromEntries(companies.map(c => [c.id, c])), [companies]);
  const coName  = useCallback(slug => coMap[slug]?.name || slug, [coMap]);
  const coGroup = useCallback(slug => coMap[slug]?.group_id || "", [coMap]);
  const GROUP_ORDER = { group_west: 0, group_china: 1, group_japan: 2, group_beauty: 3 };
  const GROUP_LABELS = { group_west: "欧米", group_china: "中国", group_japan: "日本", group_beauty: "化粧品" };
  const groupOrder = useCallback(slug => GROUP_ORDER[coGroup(slug)] ?? 9, [coGroup]);

  // ---- キューブ ----
  const buildCube = useCallback((rows, idField, countField) => {
    const c = {};
    for (const r of rows) {
      const taxId = r[idField];
      const tax = typeof taxId === "number" ? taxById[taxId] : taxByCode[taxId];
      if (!tax) continue;
      const key = `${r.canonical_slug}|${tax.code}`;
      if (!c[key]) c[key] = { all: 0 };
      c[key][r.year] = (c[key][r.year] || 0) + r[countField];
      c[key].all += r[countField];
    }
    return c;
  }, [taxById, taxByCode]);

  const patTopCube = useMemo(() => buildCube(patTop, "taxonomy_id", "patent_count"), [patTop, buildCube]);
  const papTopCube = useMemo(() => buildCube(papTop, "taxonomy_code", "paper_count"), [papTop, buildCube]);
  const patSubCube = useMemo(() => buildCube(patSub, "taxonomy_id", "patent_count"), [patSub, buildCube]);
  const papSubCube = useMemo(() => buildCube(papSub, "taxonomy_id", "paper_count"), [papSub, buildCube]);

  // 現在のビュー用キューブ
  const curPatCube = drillCat ? patSubCube : patTopCube;
  const curPapCube = drillCat ? papSubCube : papTopCube;

  const getVal = useCallback((slug, catCode, ym) => {
    const pk = `${slug}|${catCode}`;
    if (mode === "patents") return curPatCube[pk]?.[ym] || 0;
    if (mode === "papers")  return curPapCube[pk]?.[ym] || 0;
    const pat = curPatCube[pk]?.[ym] || 0;
    const pap = curPapCube[pk]?.[ym] || 0;
    return pap > 0 ? pat / pap : (pat > 0 ? Infinity : null);
  }, [mode, curPatCube, curPapCube]);

  // ---- 企業リスト ----
  const allSlugs = useMemo(() => {
    const set = new Set();
    patTop.forEach(r => set.add(r.canonical_slug));
    papTop.forEach(r => set.add(r.canonical_slug));
    return Array.from(set);
  }, [patTop, papTop]);

  const activeCompanies = useMemo(() =>
    allSlugs
      .filter(s => groupFilter === "all" || coGroup(s) === groupFilter)
      .sort((a,b) => groupOrder(a) - groupOrder(b) || coName(a).localeCompare(coName(b))),
    [allSlugs, groupFilter, coGroup, groupOrder, coName]
  );

  // ---- 色・表示 ----
  const maxVal = useMemo(() => {
    if (mode === "ratio") return 5;
    let mx = 0;
    for (const slug of activeCompanies) {
      for (const cat of cols) {
        const v = getVal(slug, cat.code, yearMode);
        if (v != null && v !== Infinity && v > mx) mx = v;
      }
    }
    return mx || 1;
  }, [activeCompanies, cols, getVal, yearMode, mode]);

  const cellColor = useCallback((val) => {
    if (val == null || val === 0) return "transparent";
    if (mode === "ratio") {
      if (val === Infinity) return "rgba(220, 50, 50, 0.8)";
      const clamped = Math.min(val, 5);
      if (clamped < 1) {
        const t = clamped;
        return `rgba(30, 64, ${Math.round(200 - t * 100)}, ${0.25 + t * 0.5})`;
      } else {
        const t = Math.min((clamped - 1) / 4, 1);
        return `rgba(${Math.round(180 + t * 60)}, 40, 40, ${0.25 + t * 0.55})`;
      }
    }
    const pct = Math.sqrt(val / maxVal);
    const base = mode === "papers" ? [30, 100, 180] : [55, 48, 163];
    return `rgba(${base[0]}, ${base[1]}, ${base[2]}, ${0.08 + pct * 0.82})`;
  }, [mode, maxVal]);

  const fmtVal = (val) => {
    if (val == null) return "·";
    if (val === Infinity) return "∞";
    if (mode === "ratio") return val === 0 ? "0" : val < 0.01 ? "<.01" : val.toFixed(2);
    return val === 0 ? "·" : val.toLocaleString();
  };

  const textColor = (val) => {
    if (val == null || val === 0) return "#94a3b8";
    if (mode === "ratio") {
      if (val === Infinity) return "#fff";
      return val > 2 || val < 0.3 ? "#fff" : "#1e293b";
    }
    const pct = Math.sqrt((typeof val === "number" ? val : 0) / maxVal);
    return pct > 0.12 ? "#fff" : "#1e293b";
  };

  const rowTotal = useCallback((slug) => {
    if (mode === "ratio") return null;
    let sum = 0;
    for (const cat of cols) { sum += getVal(slug, cat.code, yearMode) || 0; }
    return sum;
  }, [cols, getVal, yearMode, mode]);

  // ---- 選択企業詳細 ----
  const selectedDetail = useMemo(() => {
    if (!selected) return null;
    return topCats.map(cat => {
      const pat = patTopCube[`${selected}|${cat.code}`]?.all || 0;
      const pap = papTopCube[`${selected}|${cat.code}`]?.all || 0;
      const ratio = pap > 0 ? (pat / pap).toFixed(3) : pat > 0 ? "∞" : "—";
      return { code: cat.code, name: cat.name_ja, patents: pat, papers: pap, ratio };
    });
  }, [selected, topCats, patTopCube, papTopCube]);

  // ---- グループ区切り ----
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
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h2 style={S.title}>研究→IP転換分析</h2>
          {drillCat && (
            <button onClick={() => setDrillCat(null)} style={S.backBtn}>
              ← {taxByCode[drillCat]?.name_ja} から戻る
            </button>
          )}
        </div>
        <div style={S.controls}>
          <div style={S.toggleGroup}>
            {[["patents","特許"],["papers","論文"],["ratio","IP転換率"]].map(([k,l]) =>
              <button key={k} onClick={() => setMode(k)}
                style={{...S.toggle, ...(mode===k ? S.toggleActive : {})}}>
                {l}
              </button>
            )}
          </div>
          <div style={S.toggleGroup}>
            {[["all","全年"],["2024","2024"],["2025","2025"]].map(([k,l]) =>
              <button key={k} onClick={() => setYearMode(k)}
                style={{...S.toggle, ...(yearMode===k ? S.toggleActive : {})}}>
                {l}
              </button>
            )}
          </div>
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
            <span style={{...S.legendBox, background: "rgba(30,64,200,0.7)"}}/>研究先行(＜1)
            <span style={{...S.legendBox, background: "rgba(200,200,200,0.3)", marginLeft: 12}}/>均衡(≈1)
            <span style={{...S.legendBox, background: "rgba(220,40,40,0.7)", marginLeft: 12}}/>IP重視(＞1)
          </div>
        )}
      </div>

      {/* ヒートマップ */}
      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>企業</th>
              {cols.map(c => (
                <th key={c.code} style={{...S.thCat,
                  ...((!drillCat && drillable.has(c.code)) ? {cursor:"pointer", color:"#4f46e5"} : {})}}
                  onClick={() => { if (!drillCat && drillable.has(c.code)) setDrillCat(c.code); }}>
                  {c.name_ja} {!drillCat && drillable.has(c.code) ? " ⤢" : ""}
                </th>
              ))}
              {mode !== "ratio" && <th style={S.thCat}>合計</th>}
            </tr>
          </thead>
          <tbody>
            {activeCompanies.map((slug, idx) => {
              const isGroupStart = groupBoundaries.has(idx);
              return (
                <tr key={slug}
                    onClick={() => setSelected(slug === selected ? null : slug)}
                    style={{...S.tr, ...(slug === selected ? S.trSelected : {}),
                            ...(isGroupStart ? S.trGroupBorder : {}), cursor: "pointer"}}>
                  <td style={S.tdName}>
                    {isGroupStart && <span style={S.groupTag}>{GROUP_LABELS[coGroup(slug)]}</span>}
                    {coName(slug)}
                  </td>
                  {cols.map(cat => {
                    const val = getVal(slug, cat.code, yearMode);
                    return (
                      <td key={cat.code} style={{...S.tdCell, background: cellColor(val)}}>
                        <span style={{...S.cellText, color: textColor(val)}}>{fmtVal(val)}</span>
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

      {/* 詳細パネル */}
      {selected && selectedDetail && !drillCat && (
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
const S = {
  wrap: { fontFamily: "'Noto Sans JP', system-ui, sans-serif", color: "#12151F",
          maxHeight: "calc(100vh - 160px)", overflowY: "auto", paddingBottom: 40 },
  loading: { padding: 40, textAlign: "center", color: "#666" },
  header: { padding: "12px 16px", borderBottom: "1px solid #e5e7eb" },
  title: { margin: 0, fontSize: 18, fontWeight: 700 },
  backBtn: { border: "1px solid #cbd5e1", background: "#f8fafc", borderRadius: 6, padding: "4px 12px",
             cursor: "pointer", fontSize: 12, color: "#4f46e5", fontWeight: 600 },
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
  thCat: { padding: "6px 8px", textAlign: "center", fontSize: 10, fontWeight: 600, color: "#64748b",
           borderBottom: "2px solid #e2e8f0", whiteSpace: "nowrap", position: "sticky", top: 0, background: "#fff", zIndex: 2 },
  tr: { transition: "background .1s" },
  trSelected: { background: "#f0f9ff" },
  trGroupBorder: { borderTop: "2px solid #cbd5e1" },
  tdName: { padding: "4px 8px", whiteSpace: "nowrap", fontWeight: 500, fontSize: 11, borderBottom: "1px solid #f1f5f9",
            position: "sticky", left: 0, background: "#fff", zIndex: 1, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" },
  groupTag: { display: "block", fontSize: 9, color: "#94a3b8", fontWeight: 400, lineHeight: 1 },
  tdCell: { padding: "3px 2px", textAlign: "center", borderBottom: "1px solid #f8fafc", minWidth: 44, transition: "background .15s" },
  cellText: { fontSize: 10, fontFamily: "'JetBrains Mono', monospace" },
  tdTotal: { padding: "3px 6px", textAlign: "right", borderBottom: "1px solid #f1f5f9", fontWeight: 600,
             fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: "#475569" },
  detail: { margin: "16px 16px 0", padding: 16, background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" },
  detailTitle: { margin: "0 0 12px", fontSize: 15, fontWeight: 700 },
  detailTable: { width: "100%", borderCollapse: "collapse", fontSize: 12 },
  dth:  { padding: "6px 8px", textAlign: "left", fontWeight: 600, color: "#475569", borderBottom: "2px solid #e2e8f0" },
  dthR: { padding: "6px 8px", textAlign: "right", fontWeight: 600, color: "#475569", borderBottom: "2px solid #e2e8f0" },
  dtd:  { padding: "5px 8px", borderBottom: "1px solid #e5e7eb" },
  dtdR: { padding: "5px 8px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace", borderBottom: "1px solid #e5e7eb" },
};

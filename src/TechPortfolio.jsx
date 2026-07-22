// =============================================================================
// TechPortfolio.jsx ― 技術ポートフォリオ タブ（統合版）
// =============================================================================
// 旧「技術ポートフォリオ」と旧「研究→IP転換」を統合。
//   ・データ切替: 特許 / 論文 / IP転換率（特許÷論文）
//   ・表示: 絶対件数 / 企業内シェア（IP転換率モードでは非表示）
//   ・年・グループ絞り込み、大分類→サブカテゴリのドリルダウン
//   ・詳細パネル: 年次推移＋構成比（特許/論文モード）、特許vs論文 IP転換率テーブル（常時）
//
// データ元:
//   integration.technology_taxonomy        … カテゴリ名・親子・並び順
//   integration.tech_signals_patent        … 企業×大分類×年 の特許数
//   integration.tech_signals_paper         … 企業×大分類×年 の論文数
//   integration.tech_signals_subcat        … 企業×サブカテゴリ×年 の特許数
//   integration.tech_signals_paper_subcat  … 企業×サブカテゴリ×年 の論文数
//   public.companies                       … 企業名・group_id
// =============================================================================
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import PatentListModal from "./PatentListModal";

const GROUPS = [
  { id: "group_west",   label: "グループ1（欧米）" },
  { id: "group_china",  label: "グループ2（中国）" },
  { id: "group_japan",  label: "グループ3（日本）" },
  { id: "group_beauty", label: "グループ4（化粧品・美容）" },
];

const PALETTE = ["#2F5FE0","#17A29A","#6B4FD8","#D97F2E","#C94F71","#3BA55C","#8A8F9C","#B4894B","#4FA3D8"];

// ヒートマップ配色（特許=紺 / 論文=青緑）
const hx = (c)=>{c=c.replace("#","");return [parseInt(c.slice(0,2),16),parseInt(c.slice(2,4),16),parseInt(c.slice(4,6),16)];};
const H0 = hx("EEF1FB");
const HM_PAT = hx("1B2A6B"), HM_PAP = hx("0E5F5B");
const Lc = (a,b,t)=>Math.round(a+(b-a)*t);
const heat = (t, hm)=>`rgb(${Lc(H0[0],hm[0],t)},${Lc(H0[1],hm[1],t)},${Lc(H0[2],hm[2],t)})`;

// IP転換率の配色（<1=青系: 研究先行, >1=赤系: IP重視）
const ratioColor = (val) => {
  if (val == null || val === 0) return "#F5F6F9";
  if (val === Infinity) return "rgba(220,50,50,.85)";
  const clamped = Math.min(val, 5);
  if (clamped < 1) {
    const t = clamped;
    return `rgba(30,64,${Math.round(200 - t * 100)},${0.25 + t * 0.5})`;
  }
  const t = Math.min((clamped - 1) / 4, 1);
  return `rgba(${Math.round(180 + t * 60)},40,40,${0.25 + t * 0.55})`;
};

export default function TechPortfolio({ supabaseUrl, supabaseKey, sbRpc }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [taxonomy, setTaxonomy] = useState([]);
  const [patTop, setPatTop] = useState([]);
  const [papTop, setPapTop] = useState([]);
  const [patSub, setPatSub] = useState([]);
  const [papSub, setPapSub] = useState([]);
  const [companies, setCompanies] = useState([]);

  const [mode, setMode]           = useState("patents"); // patents | papers | ratio
  const [yearMode, setYearMode]   = useState("all");     // "all" | "2024" など
  const [valueMode, setValueMode] = useState("abs");     // abs | share
  const [groupFilter, setGroupFilter] = useState("all");
  const [view, setView]           = useState({ level:"top", parent:null });
  const [selected, setSelected]   = useState(null);
  const [showPatentModal, setShowPatentModal] = useState(false);
  const [filterForModal, setFilterForModal] = useState(null);

  // ---- データ取得 ----------------------------------------------------------
  const sbGet = useCallback((path, profile) => fetch(supabaseUrl + "/rest/v1/" + path, {
    headers: { apikey: supabaseKey, Authorization: "Bearer " + supabaseKey,
               Accept: "application/json",
               ...(profile ? { "Accept-Profile": profile } : {}) }
  }).then(r => { if (!r.ok) throw new Error("GET failed: " + r.status); return r.json(); }),
  [supabaseUrl, supabaseKey]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const [tax, pt, pp, ps, pps, cos] = await Promise.all([
          sbGet("technology_taxonomy?select=id,code,name_ja,parent_id,level,sort_order&order=sort_order&limit=100000", "integration"),
          sbGet("tech_signals_patent?select=canonical_slug,taxonomy_id,year,patent_count&limit=100000", "integration"),
          sbGet("tech_signals_paper?select=canonical_slug,taxonomy_code,year,paper_count&limit=100000", "integration"),
          sbGet("tech_signals_subcat?select=canonical_slug,taxonomy_id,year,patent_count&limit=100000", "integration"),
          sbGet("tech_signals_paper_subcat?select=canonical_slug,taxonomy_id,year,paper_count&limit=100000", "integration"),
          sbGet("companies?select=id,name,group_id&limit=100000"),
        ]);
        if (!alive) return;
        setTaxonomy(Array.isArray(tax)?tax:[]);
        setPatTop(Array.isArray(pt)?pt:[]);
        setPapTop(Array.isArray(pp)?pp:[]);
        setPatSub(Array.isArray(ps)?ps:[]);
        setPapSub(Array.isArray(pps)?pps:[]);
        setCompanies(Array.isArray(cos)?cos:[]);
        setErr(null);
      } catch (e) {
        if (alive) setErr(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [sbGet]);

  // ---- 分類 ----------------------------------------------------------------
  const taxById   = useMemo(() => Object.fromEntries(taxonomy.map(t => [t.id, t])), [taxonomy]);
  const taxByCode = useMemo(() => Object.fromEntries(taxonomy.map(t => [t.code, t])), [taxonomy]);
  const topCats = useMemo(
    () => taxonomy.filter(t => t.level === 1).sort((a,b)=>a.sort_order-b.sort_order),
    [taxonomy]);
  const subCatsByParent = useMemo(() => {
    const m = {};
    taxonomy.filter(t => t.level === 2).forEach(t => { (m[t.parent_id] ||= []).push(t); });
    Object.values(m).forEach(arr => arr.sort((a,b)=>a.sort_order-b.sort_order));
    return m;
  }, [taxonomy]);
  const drillable = useMemo(() => new Set(Object.keys(subCatsByParent).map(Number)), [subCatsByParent]);

  const cols = view.level === "top" ? topCats : (subCatsByParent[view.parent] || []);

  // ---- 企業 ----------------------------------------------------------------
  const coMap = useMemo(() => Object.fromEntries(companies.map(c => [c.id, c])), [companies]);
  const coName  = useCallback(slug => coMap[slug]?.name || slug, [coMap]);
  const coGroup = useCallback(slug => coMap[slug]?.group_id || "group_west", [coMap]);
  const groupOrder = useCallback(slug => {
    const i = GROUPS.findIndex(g=>g.id===coGroup(slug)); return i<0?99:i;
  }, [coGroup]);

  // ---- キューブ（slug|code → {年:数, all:数}） ------------------------------
  const buildCube = useCallback((rows, idField, countField) => {
    const c = {};
    for (const r of rows) {
      const rawId = r[idField];
      const tax = typeof rawId === "number" ? taxById[rawId] : (taxByCode[rawId] || taxById[rawId]);
      if (!tax) continue;
      const key = r.canonical_slug + "|" + tax.code;
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

  const curPatCube = view.level === "top" ? patTopCube : patSubCube;
  const curPapCube = view.level === "top" ? papTopCube : papSubCube;

  // ---- 年の選択肢（データから動的に導出） -----------------------------------
  const years = useMemo(() => {
    const s = new Set();
    [patTop, papTop, patSub, papSub].forEach(arr => arr.forEach(r => { if (r.year != null) s.add(Number(r.year)); }));
    return Array.from(s).sort();
  }, [patTop, papTop, patSub, papSub]);

  // ---- 値の取得 --------------------------------------------------------------
  const cubeVal = useCallback((cube, slug, code, ym) => {
    const rec = cube[slug + "|" + code]; if (!rec) return 0;
    return ym === "all" ? rec.all : (rec[Number(ym)] || 0);
  }, []);

  const getVal = useCallback((slug, code, ym) => {
    if (mode === "patents") return cubeVal(curPatCube, slug, code, ym);
    if (mode === "papers")  return cubeVal(curPapCube, slug, code, ym);
    const pat = cubeVal(curPatCube, slug, code, ym);
    const pap = cubeVal(curPapCube, slug, code, ym);
    return pap > 0 ? pat / pap : (pat > 0 ? Infinity : null);
  }, [mode, curPatCube, curPapCube, cubeVal]);

  const rowTot = useCallback((slug, ym) =>
    cols.reduce((s,c)=>{ const v = getVal(slug,c.code,ym); return s + ((v==null||v===Infinity)?0:v); }, 0),
  [cols, getVal]);

  // ---- 企業リスト ------------------------------------------------------------
  const allSlugs = useMemo(() => {
    const set = new Set();
    patTop.forEach(r => set.add(r.canonical_slug));
    papTop.forEach(r => set.add(r.canonical_slug));
    return Array.from(set);
  }, [patTop, papTop]);

  const activeCompanies = useMemo(() =>
    allSlugs
      .filter(slug => groupFilter === "all" || coGroup(slug) === groupFilter)
      .sort((a,b)=> groupOrder(a)-groupOrder(b) || coName(a).localeCompare(coName(b))),
    [allSlugs, groupFilter, coGroup, groupOrder, coName]);

  useEffect(() => {
    if (activeCompanies.length && !activeCompanies.includes(selected)) {
      setSelected(activeCompanies[0]);
    }
  }, [activeCompanies, selected]);

  const colColor = useCallback((col) => {
    const arr = view.level === "top" ? topCats : (subCatsByParent[view.parent]||[]);
    const idx = arr.findIndex(t=>t.id===col.id);
    return PALETTE[(idx<0?0:idx) % PALETTE.length];
  }, [view, topCats, subCatsByParent]);

  // ---- ヒートマップ強度 -------------------------------------------------------
  const heatMax = useMemo(() => {
    if (mode === "ratio") return 5;
    let mx = 0;
    activeCompanies.forEach(slug => cols.forEach(c => {
      const raw = getVal(slug,c.code,yearMode);
      const v = valueMode==="abs" ? raw
              : (rowTot(slug,yearMode) ? raw/rowTot(slug,yearMode)*100 : 0);
      if (v!=null && v!==Infinity && v>mx) mx=v;
    }));
    return mx || 1;
  }, [activeCompanies, cols, valueMode, yearMode, getVal, rowTot, mode]);

  // ---- ツールチップ -----------------------------------------------------------
  const tip = useRef(null);
  const showTip = (e, slug, col) => {
    if (!tip.current) return;
    const yl = yearMode==="all" ? "全期間" : yearMode+"年";
    const pat = cubeVal(curPatCube, slug, col.code, yearMode);
    const pap = cubeVal(curPapCube, slug, col.code, yearMode);
    const ratio = pap>0 ? (pat/pap).toFixed(2) : (pat>0 ? "∞" : "—");
    const canDrill = view.level==="top" && drillable.has(Number(col.id));
    tip.current.innerHTML =
      `${coName(slug)}<br>${col.name_ja} · ${yl}<br>`
      + `<b style="font-family:monospace">特許 ${pat} 件 / 論文 ${pap} 件</b><br>`
      + `<span style="color:#9fb0ff">IP転換率 ${ratio}</span>`
      + (canDrill ? '<br><span style="color:#9fb0ff">クリックで内訳へ</span>' : "");
    tip.current.style.opacity = 1;
    tip.current.style.left = (e.clientX+14)+"px";
    tip.current.style.top  = (e.clientY+14)+"px";
  };
  const hideTip = () => { if (tip.current) tip.current.style.opacity = 0; };

  const clickCell = (slug, col) => {
    if (view.level==="top" && drillable.has(Number(col.id))) {
      setView({ level:"drill", parent: col.id });
    } else if (view.level==="top" || view.level==="drill") {
      // モーダルを開く: 企業 × 大分類 or 小分類 の特許一覧
      // slug は canonical_slug（文字列）なので、company オブジェクトから実際の id を取得
      const company = Object.values(coMap).find(c => c.id === slug);
      const companyId = company?.id || slug; // company の id が優先、なければ slug を使用

      // 小分類の場合、parent_id を使用（taxonomy_patent_class は大分類のみ対応）
      const taxonomyId = view.level === "drill" ? col.parent_id : col.id;

      setFilterForModal({
        company_id: companyId,
        company_name: coName(slug),
        category_id: taxonomyId,
        category_name: col.name_ja,
        level: view.level, // "top" or "drill"
      });
      setShowPatentModal(true);
    } else {
      setSelected(slug);
    }
  };

  // ---- 描画 ----------------------------------------------------------------
  if (loading) return <div style={{padding:24, color:"#5A6274"}}>技術ポートフォリオを読み込み中…</div>;
  if (err) return (
    <div style={{padding:24, color:"#C94F71"}}>
      データ取得に失敗しました：{err}
      <div style={{fontSize:12, color:"#9AA1B0", marginTop:8}}>
        integration スキーマが Exposed schemas に追加されているか確認してください。
      </div>
    </div>
  );

  const S = STYLES;
  const modeLabel = mode==="patents"?"特許":mode==="papers"?"論文":"IP転換率";
  return (
    <div style={S.wrap}>
      {/* コントロール */}
      <div style={S.controls}>
        <Seg label="データ" value={mode} onChange={(v)=>{ setMode(v); if(v==="ratio") setValueMode("abs"); }}
             opts={[["patents","特許"],["papers","論文"],["ratio","IP転換率"]]}/>
        {mode !== "ratio" && (
          <Seg label="表示" value={valueMode} onChange={setValueMode}
               opts={[["abs","絶対件数"],["share","企業内シェア"]]}/>
        )}
        <Seg label="対象年" value={yearMode} onChange={setYearMode}
             opts={[...years.map(y=>[String(y),String(y)]), ["all","合計"]]}/>
        <Seg label="グループ" value={groupFilter} onChange={setGroupFilter}
             opts={[["all","全体"],["group_west","欧米"],["group_china","中国"],["group_japan","日本"],["group_beauty","美容"]]}/>
      </div>

      {/* IP転換率の凡例 */}
      {mode === "ratio" && (
        <div style={S.ratioLegend}>
          <span style={{...S.legendBox, background:"rgba(30,64,200,.7)"}}/>研究先行（＜1）
          <span style={{...S.legendBox, background:"rgba(200,200,200,.35)", marginLeft:12}}/>均衡（≈1）
          <span style={{...S.legendBox, background:"rgba(220,40,40,.7)", marginLeft:12}}/>IP重視（＞1）
          <span style={{marginLeft:12, color:"#9AA1B0"}}>∞＝論文ゼロで特許あり ・ 値＝特許数÷論文数</span>
        </div>
      )}

      {/* ヒートマップ */}
      <div style={S.panel}>
        <div style={S.panelTitle}>
          企業 × 技術カテゴリ <span style={S.badge}>{modeLabel}</span>
          {view.level==="drill" && (
            <>
              <span style={S.badge}>{taxById[view.parent]?.name_ja} の内訳</span>
              <button style={S.back} onClick={()=>setView({level:"top",parent:null})}>← 大分類へ戻る</button>
            </>
          )}
        </div>
        <div style={S.panelNote}>
          {mode==="ratio"
            ? "セル＝特許数÷論文数。青＝研究先行、赤＝IP重視。⤢ 付き列はクリックで内訳へ。企業名クリックで下に詳細。"
            : (view.level==="top"
              ? "セルの濃さ＝"+modeLabel+"数（平方根スケール）。⤢ 付きセルはクリックで内訳へ。企業名クリックで下に詳細。"
              : "サブカテゴリは非排他。1件が複数に計上されうるため、合計は親を超えます。企業名クリックで下に詳細。")}
        </div>
        <div style={{overflowX:"auto"}}>
          <div style={{...S.hm, gridTemplateColumns:`210px repeat(${cols.length}, minmax(56px,1fr))`}}>
            <div/>
            {cols.map(col => <div key={col.id} style={S.colhead}>{col.name_ja}</div>)}
            {renderRows()}
          </div>
        </div>
        {mode!=="ratio" && (
          <div style={S.legend}><span>少</span>
            <span style={{...S.legendBar, background:`linear-gradient(90deg,#EEF1FB,${mode==="papers"?"#0E5F5B":"#1B2A6B"})`}}/>
            <span>多</span>
          </div>
        )}
      </div>

      {/* 詳細 */}
      <div style={S.panel}>
        <div style={S.panelTitle}>
          選択企業の詳細 <span style={S.selname}>— {selected?coName(selected):""}
          {view.level==="drill" ? `（${taxById[view.parent]?.name_ja}）` : ""}</span>
        </div>
        {mode !== "ratio" && (
          <div style={S.detail}>
            <div>{renderTrend()}</div>
            <div>{renderComposition()}</div>
          </div>
        )}
        {renderIpTable()}
      </div>

      <div ref={tip} style={S.tooltip}/>

      {/* 特許一覧モーダル */}
      {showPatentModal && filterForModal && sbRpc && (
        <PatentListModal
          filterForModal={filterForModal}
          onClose={() => setShowPatentModal(false)}
          sbRpc={sbRpc}
          supabaseUrl={supabaseUrl}
          supabaseKey={supabaseKey}
          companies={companies}
          taxonomy={taxonomy}
          taxByCode={taxByCode}
        />
      )}
    </div>
  );

  // ---- 行描画 ---------------------------------------------------------------
  function renderRows() {
    const out = [];
    let lastGroup = null;
    const hm = mode==="papers" ? HM_PAP : HM_PAT;
    activeCompanies.forEach(slug => {
      const g = coGroup(slug);
      if (groupFilter==="all" && g!==lastGroup) {
        const label = (GROUPS.find(x=>x.id===g)||{}).label || g;
        out.push(<div key={"gh-"+g} style={{...S.grouphead, gridColumn:"1 / -1"}}>{label}</div>);
        lastGroup = g;
      }
      out.push(
        <div key={"rh-"+slug} style={{...S.rowhead, ...(slug===selected?S.rowheadSel:{})}}
             onClick={()=>setSelected(slug)}>{coName(slug)}</div>
      );
      cols.forEach(col => {
        const raw = getVal(slug, col.code, yearMode);
        const canDrill = view.level==="top" && drillable.has(Number(col.id));

        if (mode === "ratio") {
          const label = raw==null ? "·" : raw===Infinity ? "∞" : raw<0.01 ? "<.01" : raw.toFixed(2);
          out.push(
            <div key={slug+"-"+col.id}
                 style={{...S.cell, background: ratioColor(raw),
                         color: (raw==null||raw===0)?"#9AA1B0":"#fff",
                         cursor: canDrill?"zoom-in":"default", position:"relative"}}
                 onClick={()=>clickCell(slug,col)}
                 onMouseMove={(e)=>showTip(e,slug,col)} onMouseLeave={hideTip}>
              {label}
              {canDrill && <span style={S.drillMark}>⤢</span>}
            </div>
          );
          return;
        }

        const rt = rowTot(slug, yearMode);
        const val = valueMode==="abs" ? raw : (rt ? raw/rt*100 : 0);
        const t = heatMax>0 ? Math.sqrt(val)/Math.sqrt(heatMax) : 0;
        const empty = !raw;
        out.push(
          <div key={slug+"-"+col.id}
               style={{...S.cell, background: empty?"#F5F6F9":heat(t,hm),
                       color: (!empty&&t>0.55)?"#fff":(empty?"#9AA1B0":"#12151F"),
                       cursor: canDrill?"zoom-in":"default", position:"relative"}}
               onClick={()=>clickCell(slug,col)}
               onMouseMove={(e)=>showTip(e,slug,col)} onMouseLeave={hideTip}>
            {empty ? "·" : (valueMode==="abs" ? raw : val.toFixed(0)+"%")}
            {canDrill && <span style={S.drillMark}>⤢</span>}
          </div>
        );
      });
    });
    return out;
  }

  // ---- 年次推移(SVG) ---------------------------------------------------------
  function renderTrend() {
    if (!selected || years.length === 0) return null;
    const W=520,H=300,pad={l:44,r:12,t:16,b:34};
    const cs = cols.filter(c => years.some(y=>getVal(selected,c.code,String(y))>0));
    let ymax=0; cs.forEach(c=>years.forEach(y=>{const v=getVal(selected,c.code,String(y)); if(v>ymax)ymax=v;}));
    ymax=Math.max(ymax,1);
    const denom = Math.max(years.length-1, 1);
    const X=i=>pad.l+(W-pad.l-pad.r)*(i/denom);
    const Y=v=>H-pad.b-(H-pad.t-pad.b)*(v/ymax);
    const grid=[];
    for(let k=0;k<=4;k++){const gv=Math.round(ymax*k/4),gy=Y(gv);
      grid.push(<line key={"g"+k} x1={pad.l} y1={gy} x2={W-pad.r} y2={gy} stroke="#E4E7EE"/>);
      grid.push(<text key={"gt"+k} x={pad.l-8} y={gy+4} textAnchor="end" fontFamily="monospace" fontSize="10" fill="#9AA1B0">{gv}</text>);
    }
    return (
      <>
        <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"auto",display:"block"}}>
          {grid}
          {years.map((yr,i)=><text key={"x"+yr} x={X(i)} y={H-12} textAnchor="middle" fontFamily="monospace" fontSize="10" fill="#5A6274">{yr}</text>)}
          {cs.map(c=>{
            const col=colColor(c);
            const pts=years.map((yr,i)=>[X(i),Y(getVal(selected,c.code,String(yr)))]);
            return <g key={c.id}>
              <polyline fill="none" stroke={col} strokeWidth="2" strokeLinejoin="round" points={pts.map(p=>p.join(",")).join(" ")}/>
              {pts.map((p,i)=><circle key={i} cx={p[0]} cy={p[1]} r="3" fill={col}/>)}
            </g>;
          })}
        </svg>
        <div style={S.trendLegend}>
          {cs.map(c=><span key={c.id} style={S.legendItem}><i style={{...S.legendDot, background:colColor(c)}}/>{c.name_ja}</span>)}
        </div>
      </>
    );
  }

  // ---- 構成比 -----------------------------------------------------------------
  function renderComposition() {
    if (!selected) return null;
    const rt = rowTot(selected, yearMode);
    const list = cols.map(c=>({c, n:getVal(selected,c.code,yearMode)||0})).filter(r=>r.n>0).sort((a,b)=>b.n-a.n);
    const yl = yearMode==="all"?"全期間":yearMode+"年";
    const totLabel = view.level==="top" ? "総計" : "延べ計(非排他・参考値)";
    return (
      <>
        <div style={S.panelNote}>{yl}・{modeLabel} {totLabel} {rt} 件</div>
        {list.map(r=>{
          const pct = rt ? r.n/rt*100 : 0;
          return (
            <div key={r.c.id} style={S.compRow}>
              <div style={S.compLab}>{r.c.name_ja}</div>
              <div style={S.compTrack}><div style={{...S.compFill, width:pct+"%", background:colColor(r.c)}}/></div>
              <div style={S.compVal}>{pct.toFixed(0)}%</div>
            </div>
          );
        })}
      </>
    );
  }

  // ---- 特許 vs 論文 IP転換率テーブル（旧・研究→IP転換の詳細） -------------------
  function renderIpTable() {
    if (!selected) return null;
    const yl = yearMode==="all"?"全期間":yearMode+"年";
    const rows = topCats.map(cat => {
      const pat = cubeVal(patTopCube, selected, cat.code, yearMode);
      const pap = cubeVal(papTopCube, selected, cat.code, yearMode);
      const r = pap > 0 ? pat / pap : (pat > 0 ? Infinity : NaN);
      const ratioLabel = pap > 0 ? (pat/pap).toFixed(2) : pat > 0 ? "∞" : "—";
      const flag = isNaN(r) ? "—" : r === Infinity ? "●IP囲い込み" : r < 0.3 ? "★研究先行" : r < 1 ? "◯転換途上" : r > 3 ? "●IP囲い込み" : "均衡";
      const flagColor = isNaN(r) ? "#9AA1B0" : r === Infinity ? "#dc2626" : r < 0.3 ? "#2563eb" : r < 1 ? "#059669" : r > 3 ? "#dc2626" : "#6b7280";
      return { cat, pat, pap, ratioLabel, flag, flagColor };
    }).filter(row => row.pat > 0 || row.pap > 0);
    if (rows.length === 0) return null;
    return (
      <div style={{marginTop: mode!=="ratio" ? 20 : 0}}>
        <div style={{...S.panelNote, marginBottom:8}}>研究→IP転換（{yl}・特許数÷論文数・大分類ベース）</div>
        <table style={S.ipTable}>
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
            {rows.map(row => (
              <tr key={row.cat.id}>
                <td style={S.dtd}>{row.cat.name_ja}</td>
                <td style={S.dtdR}>{row.pat.toLocaleString()}</td>
                <td style={S.dtdR}>{row.pap.toLocaleString()}</td>
                <td style={S.dtdR}>{row.ratioLabel}</td>
                <td style={{...S.dtd, color: row.flagColor, fontWeight: 600}}>{row.flag}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
}

// 小さなセグメントコントロール
function Seg({ label, value, onChange, opts }) {
  return (
    <div>
      <span style={STYLES.ctrlLabel}>{label}</span>
      <div style={STYLES.seg}>
        {opts.map(([v,l],i)=>(
          <button key={v} onClick={()=>onChange(v)}
            style={{...STYLES.segBtn, ...(v===value?STYLES.segBtnOn:{}),
                    borderRight: i<opts.length-1?"1px solid #E4E7EE":"0"}}>{l}</button>
        ))}
      </div>
    </div>
  );
}

// ===== スタイル ==============================================================
const STYLES = {
  wrap:{fontFamily:"'Noto Sans JP',system-ui,sans-serif", color:"#12151F",
        maxHeight:"calc(100vh - 160px)", overflowY:"auto", paddingBottom:40, padding:16},
  controls:{display:"flex", flexWrap:"wrap", gap:"20px 32px", alignItems:"flex-end", marginBottom:14},
  ctrlLabel:{fontFamily:"monospace", fontSize:10, letterSpacing:".14em", textTransform:"uppercase", color:"#9AA1B0", display:"block", marginBottom:6},
  seg:{display:"inline-flex", border:"1px solid #CFD4DF", borderRadius:8, overflow:"hidden", background:"#fff"},
  segBtn:{fontFamily:"monospace", fontSize:12, fontWeight:500, border:0, background:"transparent", color:"#5A6274", padding:"7px 14px", cursor:"pointer"},
  segBtnOn:{background:"#12151F", color:"#fff"},
  ratioLegend:{display:"flex", alignItems:"center", gap:4, fontSize:11.5, color:"#5A6274", marginBottom:14, flexWrap:"wrap"},
  legendBox:{display:"inline-block", width:14, height:14, borderRadius:3, marginRight:4},
  panel:{background:"#fff", border:"1px solid #E4E7EE", borderRadius:14, padding:20, marginBottom:20},
  panelTitle:{fontSize:13, fontWeight:700, marginBottom:2, display:"flex", alignItems:"center", gap:10, flexWrap:"wrap"},
  panelNote:{fontSize:11.5, color:"#9AA1B0", marginBottom:16},
  badge:{fontFamily:"monospace", fontSize:10, letterSpacing:".1em", textTransform:"uppercase", color:"#3B4EE0", border:"1px solid #3B4EE0", borderRadius:5, padding:"2px 7px"},
  back:{fontFamily:"monospace", fontSize:12, color:"#3B4EE0", background:"none", border:0, cursor:"pointer", padding:0},
  hm:{display:"grid", gap:3},
  colhead:{fontSize:11, color:"#5A6274", textAlign:"center", padding:"4px 2px", lineHeight:1.25, alignSelf:"end", fontWeight:500},
  rowhead:{fontSize:13, fontWeight:500, display:"flex", alignItems:"center", paddingRight:10, cursor:"pointer", whiteSpace:"nowrap"},
  rowheadSel:{color:"#3B4EE0", fontWeight:700},
  grouphead:{fontFamily:"monospace", fontSize:10, letterSpacing:".12em", textTransform:"uppercase", color:"#9AA1B0", padding:"12px 0 4px", borderBottom:"1px solid #E4E7EE", marginTop:4},
  cell:{height:44, borderRadius:6, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"monospace", fontSize:13, fontWeight:500},
  drillMark:{position:"absolute", top:3, right:5, fontSize:9, opacity:.55},
  legend:{display:"flex", alignItems:"center", gap:10, marginTop:14, fontFamily:"monospace", fontSize:11, color:"#9AA1B0"},
  legendBar:{height:10, width:180, borderRadius:5},
  detail:{display:"grid", gridTemplateColumns:"1.4fr 1fr", gap:20},
  selname:{fontFamily:"monospace", fontSize:12, color:"#3B4EE0", fontWeight:500},
  trendLegend:{display:"flex", flexWrap:"wrap", gap:"6px 14px", marginTop:12, fontSize:11.5, color:"#5A6274"},
  legendItem:{display:"inline-flex", alignItems:"center", gap:5},
  legendDot:{width:10, height:10, borderRadius:2, display:"inline-block"},
  compRow:{display:"grid", gridTemplateColumns:"140px 1fr 46px", alignItems:"center", gap:10, marginBottom:9},
  compLab:{fontSize:12, color:"#5A6274", textAlign:"right", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"},
  compTrack:{height:16, background:"#F5F6F9", borderRadius:4, overflow:"hidden"},
  compFill:{height:"100%", borderRadius:4},
  compVal:{fontFamily:"monospace", fontSize:11.5, color:"#5A6274", textAlign:"right"},
  ipTable:{width:"100%", borderCollapse:"collapse", fontSize:12},
  dth:  {padding:"6px 8px", textAlign:"left",  fontWeight:600, color:"#475569", borderBottom:"2px solid #e2e8f0"},
  dthR: {padding:"6px 8px", textAlign:"right", fontWeight:600, color:"#475569", borderBottom:"2px solid #e2e8f0"},
  dtd:  {padding:"5px 8px", borderBottom:"1px solid #e5e7eb"},
  dtdR: {padding:"5px 8px", textAlign:"right", fontFamily:"monospace", borderBottom:"1px solid #e5e7eb"},
  tooltip:{position:"fixed", pointerEvents:"none", background:"#12151F", color:"#fff", fontSize:12, padding:"7px 10px", borderRadius:7, opacity:0, transition:"opacity .1s", zIndex:50, maxWidth:260, lineHeight:1.4},
};

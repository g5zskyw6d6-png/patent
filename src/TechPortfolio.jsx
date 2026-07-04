// =============================================================================
// TechPortfolio.jsx ― 技術ポートフォリオ タブ(実データ接続版)
// =============================================================================
// プロトタイプv3のロジック(ヒートマップ + サブカテゴリdrill + グループ分け +
// 年/表示モード切替)を、Supabase(integration スキーマ)から実データで描画する版。
//
// データ元:
//   integration.technology_taxonomy   … カテゴリ名・親子・並び順
//   integration.tech_signals_patent   … 企業×大分類×年 の特許数
//   integration.tech_signals_subcat   … 企業×サブカテゴリ×年 の特許数
//   public.companies                  … 企業名・group_id
//
// 前提: Supabase Settings → API → Exposed schemas に「integration」を追加済み。
//       (非publicスキーマは Accept-Profile ヘッダで指定して読む)
//
// props: supabaseUrl, supabaseKey, c, card (既存タブと同じ流儀。スタイルは後で c/card に寄せる)
// =============================================================================
import { useState, useEffect, useCallback, useMemo, useRef } from "react";

// グループ定義(companies.group_id に対応。表示順は配列順)
const GROUPS = [
  { id: "group_west",   label: "グループ1（欧米）" },
  { id: "group_china",  label: "グループ2（中国）" },
  { id: "group_japan",  label: "グループ3（日本）" },
  { id: "group_beauty", label: "グループ4（化粧品・美容）" },
];
const GROUP_SHORT = { all:"全体", group_west:"欧米", group_china:"中国", group_japan:"日本", group_beauty:"美容" };

// カテゴリ配色(名前ベース。カテゴリが増えたらフォールバック色)
const PALETTE = ["#2F5FE0","#17A29A","#6B4FD8","#D97F2E","#C94F71","#3BA55C","#8A8F9C","#B4894B","#4FA3D8"];

// 色ユーティリティ
const hx = (c)=>{c=c.replace("#","");return [parseInt(c.slice(0,2),16),parseInt(c.slice(2,4),16),parseInt(c.slice(4,6),16)];};
const H0 = hx("EEF1FB"), HM = hx("1B2A6B");
const Lc = (a,b,t)=>Math.round(a+(b-a)*t);
const heat = (t)=>`rgb(${Lc(H0[0],HM[0],t)},${Lc(H0[1],HM[1],t)},${Lc(H0[2],HM[2],t)})`;

export default function TechPortfolio({ supabaseUrl, supabaseKey /*, c, card */ }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [taxonomy, setTaxonomy] = useState([]);   // technology_taxonomy 行
  const [rowsTop, setRowsTop] = useState([]);     // tech_signals_patent 行
  const [rowsSub, setRowsSub] = useState([]);     // tech_signals_subcat 行
  const [companies, setCompanies] = useState([]); // {id,name,group_id}

  const [yearMode, setYearMode] = useState("all");   // 2024|2025|2026|all
  const [valueMode, setValueMode] = useState("abs"); // abs|share
  const [groupFilter, setGroupFilter] = useState("all");
  const [view, setView] = useState({ level:"top", parent:null }); // top | drill(parent=taxonomy_id)
  const [selected, setSelected] = useState(null);   // canonical_slug

  const YEARS = [2024, 2025, 2026];

  // integration スキーマ用 GET(Accept-Profile を付与)
  const sbGetInt = useCallback(async (path) => {
    const res = await fetch(supabaseUrl + "/rest/v1/" + path, {
      headers: {
        apikey: supabaseKey,
        Authorization: "Bearer " + supabaseKey,
        Accept: "application/json",
        "Accept-Profile": "integration",
      },
    });
    if (!res.ok) throw new Error("integration GET failed: " + res.status);
    return res.json();
  }, [supabaseUrl, supabaseKey]);

  // public スキーマ用 GET(既存 sbGet 相当)
  const sbGetPub = useCallback(async (path) => {
    const res = await fetch(supabaseUrl + "/rest/v1/" + path, {
      headers: { apikey: supabaseKey, Authorization: "Bearer " + supabaseKey, Accept: "application/json" },
    });
    if (!res.ok) throw new Error("public GET failed: " + res.status);
    return res.json();
  }, [supabaseUrl, supabaseKey]);

  // 初回ロード
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const [tax, top, sub, cos] = await Promise.all([
          sbGetInt("technology_taxonomy?select=id,code,name_ja,parent_id,level,sort_order&order=sort_order"),
          sbGetInt("tech_signals_patent?select=canonical_slug,taxonomy_id,year,patent_count"),
          sbGetInt("tech_signals_subcat?select=canonical_slug,taxonomy_id,year,patent_count"),
          sbGetPub("companies?select=id,name,group_id"),
        ]);
        if (!alive) return;
        setTaxonomy(tax); setRowsTop(top); setRowsSub(sub); setCompanies(cos);
        setErr(null);
      } catch (e) {
        if (alive) setErr(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [sbGetInt, sbGetPub]);

  // ---- 派生: taxonomy 索引 -------------------------------------------------
  const taxById = useMemo(() => Object.fromEntries(taxonomy.map(t => [t.id, t])), [taxonomy]);
  const topCats = useMemo(
    () => taxonomy.filter(t => t.level === 1).sort((a,b)=>a.sort_order-b.sort_order),
    [taxonomy]);
  const subCatsByParent = useMemo(() => {
    const m = {};
    taxonomy.filter(t => t.level === 2).forEach(t => { (m[t.parent_id] ||= []).push(t); });
    Object.values(m).forEach(arr => arr.sort((a,b)=>a.sort_order-b.sort_order));
    return m;
  }, [taxonomy]);
  // ドリル可能な大分類 = サブカテゴリを持つもの
  const drillable = useMemo(() => new Set(Object.keys(subCatsByParent).map(Number)), [subCatsByParent]);

  // 企業名・グループの索引(canonical_slug = companies.id 前提)
  const coName = useCallback(slug => (companies.find(c=>c.id===slug)?.name) || slug, [companies]);
  const coGroup = useCallback(slug => (companies.find(c=>c.id===slug)?.group_id) || "group_west", [companies]);
  const groupOrder = useCallback(slug => {
    const i = GROUPS.findIndex(g=>g.id===coGroup(slug)); return i<0?99:i;
  }, [coGroup]);

  // ---- 現ビューの行データ・列 ---------------------------------------------
  const rows = view.level === "top" ? rowsTop : rowsSub;
  const cols = view.level === "top"
    ? topCats
    : (subCatsByParent[view.parent] || []);

  // slug -> taxonomy_id -> {year:count}
  const cube = useMemo(() => {
    const m = {};
    const colIds = new Set(cols.map(c=>c.id));
    rows.forEach(r => {
      if (view.level === "drill" && Number(r.taxonomy_id) !== Number(view.parent) && !colIds.has(Number(r.taxonomy_id))) {
        // drill時は該当親のサブカテゴリのみ
      }
      if (!colIds.has(Number(r.taxonomy_id))) return;
      ((m[r.canonical_slug] ||= {})[r.taxonomy_id] ||= {})[r.year] = r.patent_count;
    });
    return m;
  }, [rows, cols, view]);

  const cnt = useCallback((slug, taxId, ym) => {
    const rec = cube[slug]?.[taxId]; if (!rec) return 0;
    return ym === "all" ? YEARS.reduce((s,y)=>s+(rec[y]||0),0) : (rec[ym]||0);
  }, [cube]);
  const rowTot = useCallback((slug, ym) => cols.reduce((s,c)=>s+cnt(slug,c.id,ym),0), [cols, cnt]);

  // 全企業の母集団(大分類データ tech_signals_patent 基準)。
  // これを使うことで、サブカテゴリに降りても表示企業が減らない(全ゼロなら "·" 表示)。
  const allSlugs = useMemo(
    () => Array.from(new Set(rowsTop.map(r => r.canonical_slug))),
    [rowsTop]
  );

  // 対象企業(グループ絞り + グループ順 + 名前順)。ビューに関わらず全企業を表示。
  const activeCompanies = useMemo(() => {
    return allSlugs
      .filter(slug => groupFilter === "all" || coGroup(slug) === groupFilter)
      .sort((a,b)=> groupOrder(a)-groupOrder(b) || coName(a).localeCompare(coName(b)));
  }, [allSlugs, groupFilter, coGroup, groupOrder, coName]);

  // 選択企業が現ビューにいなければ先頭へ
  useEffect(() => {
    if (activeCompanies.length && !activeCompanies.includes(selected)) {
      setSelected(activeCompanies[0]);
    }
  }, [activeCompanies, selected]);

  const colColor = useCallback((col) => {
    // 大分類は sort_order、サブは親内 index でパレット割当
    const idx = view.level === "top"
      ? topCats.findIndex(t=>t.id===col.id)
      : (subCatsByParent[view.parent]||[]).findIndex(t=>t.id===col.id);
    return PALETTE[(idx<0?0:idx) % PALETTE.length];
  }, [view, topCats, subCatsByParent]);

  // ---- ヒートマップ最大値(強度) --------------------------------------------
  const heatMax = useMemo(() => {
    let mx = 0;
    activeCompanies.forEach(slug => cols.forEach(c => {
      const v = valueMode==="abs" ? cnt(slug,c.id,yearMode)
              : (rowTot(slug,yearMode) ? cnt(slug,c.id,yearMode)/rowTot(slug,yearMode)*100 : 0);
      if (v>mx) mx=v;
    }));
    return mx;
  }, [activeCompanies, cols, valueMode, yearMode, cnt, rowTot]);

  const tip = useRef(null);
  const showTip = (e, slug, col) => {
    const raw = cnt(slug, col.id, yearMode);
    const yl = yearMode==="all" ? "全期間" : yearMode+"年";
    const canDrill = view.level==="top" && drillable.has(Number(col.id));
    if (!tip.current) return;
    tip.current.innerHTML = `${coName(slug)}<br>${col.name_ja} · ${yl}<br><b style="font-family:monospace">${raw} 件</b>`
      + (canDrill ? '<br><span style="color:#9fb0ff">クリックで内訳へ</span>' : "");
    tip.current.style.opacity = 1;
    tip.current.style.left = (e.clientX+14)+"px";
    tip.current.style.top  = (e.clientY+14)+"px";
  };
  const hideTip = () => { if (tip.current) tip.current.style.opacity = 0; };

  const clickCell = (slug, col) => {
    if (view.level==="top" && drillable.has(Number(col.id))) {
      setView({ level:"drill", parent: col.id });
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
  return (
    <div style={S.wrap}>
      {/* コントロール */}
      <div style={S.controls}>
        <Seg label="対象年" value={yearMode} onChange={setYearMode}
             opts={[["2024","2024"],["2025","2025"],["2026","2026"],["all","合計"]]}/>
        <Seg label="表示" value={valueMode} onChange={setValueMode}
             opts={[["abs","絶対件数"],["share","企業内シェア"]]}/>
        <Seg label="グループ" value={groupFilter} onChange={setGroupFilter}
             opts={[["all","全体"],["group_west","欧米"],["group_china","中国"],["group_japan","日本"],["group_beauty","美容"]]}/>
      </div>

      {/* ヒートマップ */}
      <div style={S.panel}>
        <div style={S.panelTitle}>
          {view.level==="top"
            ? "企業 × 技術カテゴリ"
            : <>{taxById[view.parent]?.name_ja} <span style={S.badge}>サブカテゴリ内訳</span>
                <button style={S.back} onClick={()=>setView({level:"top",parent:null})}>← 大分類へ戻る</button></>}
        </div>
        <div style={S.panelNote}>
          {view.level==="top"
            ? "セルの濃さ＝特許数（平方根スケール）。⤢ 付きセルはクリックで内訳へ。企業名クリックで下に詳細。"
            : "サブカテゴリは非排他。1件が複数に計上されうるため、合計は親を超えます。企業名クリックで下に詳細。"}
        </div>
        <div style={{overflowX:"auto"}}>
          <div style={{...S.hm, gridTemplateColumns:`210px repeat(${cols.length}, minmax(56px,1fr))`}}>
            <div/>
            {cols.map(col => <div key={col.id} style={S.colhead}>{col.name_ja}</div>)}
            {renderRows()}
          </div>
        </div>
        <div style={S.legend}><span>少</span><span style={S.legendBar}/><span>多</span></div>
      </div>

      {/* 詳細 */}
      <div style={S.panel}>
        <div style={S.panelTitle}>
          選択企業の詳細 <span style={S.selname}>— {selected?coName(selected):""}
          {view.level==="drill" ? `（${taxById[view.parent]?.name_ja}）` : ""}</span>
        </div>
        <div style={S.detail}>
          <div>{renderTrend()}</div>
          <div>{renderComposition()}</div>
        </div>
      </div>

      <div ref={tip} style={S.tooltip}/>
    </div>
  );

  // ---- 行描画(グループ見出し込み) -----------------------------------------
  function renderRows() {
    const out = [];
    let lastGroup = null;
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
        const raw = cnt(slug, col.id, yearMode), rt = rowTot(slug, yearMode);
        const val = valueMode==="abs" ? raw : (rt ? raw/rt*100 : 0);
        const t = heatMax>0 ? Math.sqrt(val)/Math.sqrt(heatMax) : 0;
        const empty = raw===0;
        const canDrill = view.level==="top" && drillable.has(Number(col.id));
        out.push(
          <div key={slug+"-"+col.id}
               style={{...S.cell, background: empty?"#F5F6F9":heat(t),
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

  // ---- 年次推移(SVG) -------------------------------------------------------
  function renderTrend() {
    if (!selected) return null;
    const W=520,H=300,pad={l:44,r:12,t:16,b:34};
    const cs = cols.filter(c => YEARS.some(y=>cnt(selected,c.id,String(y))>0));
    let ymax=0; cs.forEach(c=>YEARS.forEach(y=>{const v=cnt(selected,c.id,String(y)); if(v>ymax)ymax=v;}));
    ymax=Math.max(ymax,1);
    const X=i=>pad.l+(W-pad.l-pad.r)*(i/(YEARS.length-1));
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
          {YEARS.map((yr,i)=><text key={"x"+yr} x={X(i)} y={H-12} textAnchor="middle" fontFamily="monospace" fontSize="10" fill="#5A6274">{yr}</text>)}
          {cs.map(c=>{
            const col=colColor(c);
            const pts=YEARS.map((yr,i)=>[X(i),Y(cnt(selected,c.id,String(yr)))]);
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

  // ---- 構成比 --------------------------------------------------------------
  function renderComposition() {
    if (!selected) return null;
    const rt = rowTot(selected, yearMode);
    const list = cols.map(c=>({c, n:cnt(selected,c.id,yearMode)})).filter(r=>r.n>0).sort((a,b)=>b.n-a.n);
    const yl = yearMode==="all"?"全期間":yearMode+"年";
    const totLabel = view.level==="top" ? "総計" : "延べ計(非排他・参考値)";
    return (
      <>
        <div style={S.panelNote}>{yl}・{totLabel} {rt} 件</div>
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

// ===== スタイル(後で c/card に寄せる。今はプロトタイプ相当の自前) ============
const STYLES = {
  wrap:{fontFamily:"'Noto Sans JP',system-ui,sans-serif", color:"#12151F"},
  controls:{display:"flex", flexWrap:"wrap", gap:"20px 32px", alignItems:"flex-end", marginBottom:20},
  ctrlLabel:{fontFamily:"monospace", fontSize:10, letterSpacing:".14em", textTransform:"uppercase", color:"#9AA1B0", display:"block", marginBottom:6},
  seg:{display:"inline-flex", border:"1px solid #CFD4DF", borderRadius:8, overflow:"hidden", background:"#fff"},
  segBtn:{fontFamily:"monospace", fontSize:12, fontWeight:500, border:0, background:"transparent", color:"#5A6274", padding:"7px 14px", cursor:"pointer"},
  segBtnOn:{background:"#12151F", color:"#fff"},
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
  legendBar:{height:10, width:180, borderRadius:5, background:"linear-gradient(90deg,#EEF1FB,#1B2A6B)"},
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
  tooltip:{position:"fixed", pointerEvents:"none", background:"#12151F", color:"#fff", fontSize:12, padding:"7px 10px", borderRadius:7, opacity:0, transition:"opacity .1s", zIndex:50, maxWidth:230, lineHeight:1.4},
};

import { useState, useCallback, useEffect } from "react";
import Dashboard from "./Dashboard";

const EPO_CONSUMER_KEY    = import.meta.env.VITE_EPO_CONSUMER_KEY;
const EPO_CONSUMER_SECRET = import.meta.env.VITE_EPO_CONSUMER_SECRET;
const CLAUDE_API_KEY      = import.meta.env.VITE_CLAUDE_API_KEY;
const SUPABASE_URL        = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY   = import.meta.env.VITE_SUPABASE_ANON_KEY;

const TARGET_COUNTRIES = ["WO"];
const COUNTRY_COLORS   = { US:"#38bdf8", WO:"#34d399", JP:"#f59e0b" };

const LS_KEY = "patent_cache_v2";
function saveToLS(co, pts, tot, f, t) {
  try { const d=JSON.parse(localStorage.getItem(LS_KEY)||"{}"); d[co.id]={company:co,patents:pts,total:tot,dateFrom:f,dateTo:t,savedAt:new Date().toISOString()}; localStorage.setItem(LS_KEY,JSON.stringify(d)); } catch(e){}
}
function loadFromLS(id){ try{const c=JSON.parse(localStorage.getItem(LS_KEY)||"{}")[id]; if(!c||!Array.isArray(c.patents))return null; return c;}catch(e){return null;} }
function getCachedIds(){ try{return Object.keys(JSON.parse(localStorage.getItem(LS_KEY)||"{}"));}catch(e){return[];} }
function deleteFromLS(id){ try{const d=JSON.parse(localStorage.getItem(LS_KEY)||"{}");delete d[id];localStorage.setItem(LS_KEY,JSON.stringify(d));}catch(e){} }

const dbReady = () => SUPABASE_URL && !SUPABASE_URL.includes("ここに");
// ★ リトライ付きfetch（一時的なネットワーク切断に対応）
async function fetchWithRetry(url, options = {}, retries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.ok || res.status < 500) return res;
      lastErr = new Error("HTTP " + res.status);
    } catch(e) {
      lastErr = e;
      console.warn("fetchWithRetry attempt " + attempt + " failed:", e.message);
    }
    if (attempt < retries) await new Promise(r => setTimeout(r, 1500 * attempt));
  }
  throw lastErr;
}
const sbH = () => ({"apikey":SUPABASE_ANON_KEY,"Authorization":"Bearer "+SUPABASE_ANON_KEY,"Content-Type":"application/json","Prefer":"resolution=merge-duplicates,return=minimal"});

async function sbUpsert(table, rows) {
  if (!dbReady() || !rows.length) return;
  const authH = {
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": "Bearer " + SUPABASE_ANON_KEY,
  };
  const jsonH = {
    ...authH,
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
  };

  // ① 既存レコードをDELETE（Safari CORS対策：authHeadersのみ）
  const ids = [...new Set(rows.map(r => r.patent_number || r.id).filter(Boolean))];
  if (ids.length > 0) {
    const col = rows[0].patent_number !== undefined ? "patent_number" : "id";
    const delUrl = SUPABASE_URL + "/rest/v1/" + table
      + "?" + col + "=in.(" + ids.map(id => encodeURIComponent(id)).join(",") + ")";
    await fetch(delUrl, { method: "DELETE", headers: authH }).catch(() => {});
  }

  // ② INSERT
  const res = await fetchWithRetry(
    SUPABASE_URL + "/rest/v1/" + table,
    { method: "POST", headers: jsonH, body: JSON.stringify(rows) },
    3
  );
  if (!res.ok) console.warn("Supabase upsert failed (" + table + "):", res.status);
}
async function savePatentsToDB(company, patents) {
  await sbUpsert("companies",[{id:company.id,name:company.name,legal:company.legal,sector:company.sector,flag:company.flag,group_id:company.group_id||null}]);
  const rows = patents.map(p=>({patent_number:p.patent_number,title_en:p.patent_title,publication_date:p.patent_date||null,company_id:company.id,company_name:company.name,country:p.country,abstract_epo:p.patent_abstract||null,inventors:p.inventors&&p.inventors.length>0?p.inventors:null}));
  for (let i=0;i<rows.length;i+=100){ await sbUpsert("patents",rows.slice(i,i+100)); await new Promise(r=>setTimeout(r,200)); }
}

async function getEPOToken() {
  const res = await fetch("/api/epo/auth/accesstoken",{method:"POST",headers:{"Authorization":"Basic "+btoa(EPO_CONSUMER_KEY+":"+EPO_CONSUMER_SECRET),"Content-Type":"application/x-www-form-urlencoded"},body:"grant_type=client_credentials"});
  if (!res.ok) throw new Error("EPO認証失敗: "+res.status);
  return (await res.json()).access_token;
}
function parseXMLPatents(doc) {
  const patents=[];
  doc.querySelectorAll("exchange-document").forEach(ed=>{
    const country=ed.getAttribute("country")||"",docNum=ed.getAttribute("doc-number")||"",kind=ed.getAttribute("kind")||"";
    if (!TARGET_COUNTRIES.includes(country)) return;
    let title="";
    ed.querySelectorAll("invention-title").forEach(t=>{if(!title||t.getAttribute("lang")==="en")title=t.textContent.trim();});
    let rawDate=ed.querySelector("publication-reference date")?.textContent?.trim()||"";
    if(rawDate.length===8)rawDate=rawDate.slice(0,4)+"-"+rawDate.slice(4,6)+"-"+rawDate.slice(6,8);
    let abstract="";
    ed.querySelectorAll("abstract").forEach(a=>{if(!abstract||a.getAttribute("lang")==="en")abstract=Array.from(a.querySelectorAll("p")).map(p=>p.textContent.trim()).join(" ").trim();});
    const inventors=[];
    ed.querySelectorAll("inventor").forEach(inv=>{const n=inv.querySelector("name");if(n)inventors.push(n.textContent.trim());});
    if(inventors.length===0)ed.querySelectorAll("applicant").forEach(ap=>{if(ap.getAttribute("app-type")==="inventor"){const n=ap.querySelector("name");if(n)inventors.push(n.textContent.trim());}});
    if(docNum)patents.push({patent_number:country+docNum+kind,patent_title:title||"(タイトル未取得)",patent_date:rawDate,patent_abstract:abstract,inventors,country,docNum,kind});
  });
  return patents;
}
async function fetchPatents(legalNames, from, to) {
  const token   = await getEPOToken();
  const fromEPO = from.replace(/-/g, ""), toEPO = to.replace(/-/g, "");
  // ★ 複数出願人名をOR条件で結合
  const names   = Array.isArray(legalNames) ? legalNames.filter(Boolean) : [legalNames];
  const paClause = names.map(n => `pa="${n}"`).join(" OR ");
  const cql     = `(${paClause}) AND pd within "${fromEPO},${toEPO}" AND (${TARGET_COUNTRIES.map(c=>"pn="+c).join(" OR ")})`;
  const headers = { "Authorization":"Bearer "+token, "Accept":"application/xml" };
  const endpoint = "/api/epo/published-data/search/biblio,abstract";
  const parser  = new DOMParser();
  const first   = await fetch(endpoint+"?q="+encodeURIComponent(cql)+"&Range=1-100", {headers});
  if (!first.ok) { const txt=await first.text(); throw new Error("EPO検索失敗 ("+first.status+"): "+txt.slice(0,300)); }
  const firstDoc   = parser.parseFromString(await first.text(), "application/xml");
  const total      = parseInt(firstDoc.querySelector("biblio-search")?.getAttribute("total-result-count")||"0", 10);
  const allPatents = parseXMLPatents(firstDoc);
  for (let page=2; page<=Math.ceil(Math.min(total,2000)/100); page++) {
    const start=(page-1)*100+1, end=Math.min(page*100, Math.min(total,2000));
    const res = await fetch(endpoint+"?q="+encodeURIComponent(cql)+"&Range="+start+"-"+end, {headers});
    if (!res.ok) break;
    allPatents.push(...parseXMLPatents(parser.parseFromString(await res.text(),"application/xml")));
    await new Promise(r=>setTimeout(r,300));
  }
  return { patents:allPatents, total_patent_count:total };
}

export default function App() {
  const [groups,        setGroups]        = useState([]);
  const [companies,     setCompanies]     = useState([]);
  const [selGroupId,    setSelGroupId]    = useState(null);
  const [company,       setCompany]       = useState(null);
  const [dateFrom,      setDateFrom]      = useState("2024-01-01");
  const [dateTo,        setDateTo]        = useState("2026-03-31");
  const [phase,         setPhase]         = useState("idle");
  const [patents,       setPatents]       = useState([]);
  const [total,         setTotal]         = useState(0);
  const [showDashboard, setShowDashboard] = useState(false);
  const [err,           setErr]           = useState("");
  const [dbStatus,      setDbStatus]      = useState("");
  const [filter,        setFilter]        = useState("");
  const [cachedIds,     setCachedIds]     = useState(()=>getCachedIds());
  const [patentStats, setPatentStats] = useState({}); //
const loadFromDB = useCallback(async () => {
    if (!dbReady()) return;
    const h = {"apikey":SUPABASE_ANON_KEY,"Authorization":"Bearer "+SUPABASE_ANON_KEY,"Accept":"application/json"};
    try {
      const [gRes, cRes, sRes] = await Promise.all([
        fetchWithRetry(SUPABASE_URL+"/rest/v1/company_groups?select=*&order=sort_order.asc", {headers:h}),
        fetchWithRetry(SUPABASE_URL+"/rest/v1/companies?select=id,name,legal,flag,sector,group_id&order=name.asc", {headers:h}),
        fetchWithRetry(SUPABASE_URL+"/rest/v1/company_patent_stats?select=*", {headers:h}),
      ]);
      if (gRes.ok) {
        const g = await gRes.json();
        setGroups(g||[]);
        if (g&&g.length>0&&!selGroupId) setSelGroupId(g[0].id);
      }
      if (cRes.ok) {
        const c = await cRes.json();
        setCompanies((c||[]).map(r=>({...r,legal:r.legal||r.name})));
      }
      if (sRes.ok) {
        const stats = await sRes.json();
        const map = {};
        (stats||[]).forEach(s => { map[s.company_id] = s; });
        setPatentStats(map);
      }
    } catch(e) {
      console.warn("loadFromDB failed:", e.message);
      // 失敗してもアプリは動作継続（DEFAULT_COMPANIESを使用）
    }
  }, []);


  useEffect(()=>{ loadFromDB(); },[loadFromDB]);

  const groupCompanies = companies.filter(c=>c.group_id===selGroupId);
  const visibleCompanies = filter
    ? companies.filter(c=>c.name.toLowerCase().includes(filter.toLowerCase()))
    : groupCompanies;

  const selGroup = groups.find(g=>g.id===selGroupId);
  const groupColor = selGroup?.color || "#38bdf8";

  const doFetch = useCallback(async()=>{
    if (!company) return;
    setPhase("fetching"); setErr(""); setDbStatus(""); setPatents([]);
    try {
      const d = await fetchPatents(company.legal, dateFrom, dateTo);
      setPatents(d.patents); setTotal(d.total_patent_count);
      saveToLS(company,d.patents,d.total_patent_count,dateFrom,dateTo);
      setCachedIds(getCachedIds()); setPhase("done");
      if (d.patents.length===0){setErr("取得0件でした。期間・企業名を確認してください。");return;}
      if (dbReady()){
        setDbStatus("DBに保存中...");
        await savePatentsToDB(company,d.patents);
        setDbStatus("DB保存完了（"+d.patents.length+"件）");
      }
    } catch(e){setErr("EPO API エラー: "+e.message);setPhase("idle");}
  },[company,dateFrom,dateTo]);

  const selectCompany = co => {
    setCompany(co); setErr(""); setDbStatus("");
    try{
      const cached=loadFromLS(co.id);
      if(cached){setPatents(cached.patents||[]);setTotal(cached.total||0);setDateFrom(cached.dateFrom||"2024-01-01");setDateTo(cached.dateTo||"2026-03-31");setPhase("done");setErr("キャッシュから復元（"+new Date(cached.savedAt).toLocaleString("ja-JP")+"）");}
      else{setPatents([]);setPhase("idle");}
    }catch(e){deleteFromLS(co.id);setCachedIds(getCachedIds());setPatents([]);setPhase("idle");}
  };

  const c = {bg0:"#030b14",bg1:"#071828",bg2:"#0d2137",border:"#1a3550",text:"#cce3f5",muted:"#5c87ac",cyan:"#38bdf8",amber:"#f59e0b",green:"#34d399",purple:"#818cf8"};
  const card = {background:c.bg1,border:"1px solid "+c.border,borderRadius:10,padding:"14px 16px"};

  const reloadCompanies = useCallback(()=>{ loadFromDB(); },[loadFromDB]);

  if (showDashboard) return (
    <Dashboard
      supabaseUrl={SUPABASE_URL} supabaseKey={SUPABASE_ANON_KEY}
      claudeApiKey={CLAUDE_API_KEY}
      epoConsumerKey={EPO_CONSUMER_KEY} epoConsumerSecret={EPO_CONSUMER_SECRET}
      companies={companies} groups={groups}
      onClose={()=>{ setShowDashboard(false); reloadCompanies(); }}
    />
  );

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100vh",background:c.bg0,color:c.text,fontFamily:"system-ui,-apple-system,sans-serif",overflow:"hidden"}}>

      {/* ヘッダー */}
      <div style={{display:"flex",alignItems:"center",gap:12,padding:"0 18px",height:50,borderBottom:"1px solid "+c.border,background:c.bg1,flexShrink:0}}>
        <div style={{width:8,height:8,borderRadius:"50%",background:c.cyan}}/>
        <span style={{fontWeight:700,fontSize:14,color:c.cyan}}>PATENT INTELLIGENCE</span>
        <span style={{fontSize:12,color:c.muted}}>特許取得 / EPO OPS</span>
        <div style={{display:"flex",gap:4}}>
          {TARGET_COUNTRIES.map(ct=>(
            <span key={ct} style={{fontSize:11,fontWeight:700,color:COUNTRY_COLORS[ct],padding:"1px 7px",borderRadius:4,border:"1px solid "+COUNTRY_COLORS[ct],background:"#030b14"}}>{ct}</span>
          ))}
        </div>
        <button onClick={()=>setShowDashboard(true)}
          style={{marginLeft:8,padding:"5px 16px",borderRadius:6,border:"1px solid "+c.purple,background:"#0d0820",color:c.purple,fontSize:12,cursor:"pointer",fontWeight:700}}>
          📊 ダッシュボード
        </button>
        <div style={{marginLeft:"auto",fontSize:12}}>
          {phase==="fetching"&&<span style={{color:c.amber}}>● EPO OPS 取得中...</span>}
          {phase==="done"&&patents.length>0&&<span style={{color:c.green}}>✓ 取得完了</span>}
        </div>
      </div>

      <div style={{display:"flex",flex:1,overflow:"hidden"}}>

        {/* 左サイドバー */}
        <div style={{width:260,borderRight:"1px solid "+c.border,background:c.bg1,display:"flex",flexDirection:"column",flexShrink:0}}>

          {/* グループタブ */}
          <div style={{borderBottom:"1px solid "+c.border,flexShrink:0}}>
            <div style={{display:"flex",overflowX:"auto",padding:"8px 8px 0"}}>
              {groups.map(g=>{
                const active=g.id===selGroupId;
                return (
                  <button key={g.id} onClick={()=>{setSelGroupId(g.id);setFilter("");}}
                    style={{padding:"6px 12px",borderRadius:"6px 6px 0 0",border:"1px solid "+(active?c.border:c.border),borderBottom:active?"1px solid "+c.bg1:"none",background:active?c.bg1:"transparent",color:active?g.color:c.muted,fontSize:11,fontWeight:active?700:400,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0,marginRight:2}}>
                    {g.name.replace("グループ","G")}
                  </button>
                );
              })}
              <button onClick={()=>setFilter("◎")}
                style={{padding:"6px 10px",borderRadius:"6px 6px 0 0",border:"1px solid "+c.border,borderBottom:"none",background:"transparent",color:c.muted,fontSize:11,cursor:"pointer",flexShrink:0,marginRight:2}}>
                全件
              </button>
            </div>
          </div>

          {/* グループ情報 */}
          {selGroup && !filter && (
            <div style={{padding:"8px 12px",borderBottom:"1px solid "+c.border,flexShrink:0}}>
              <div style={{fontSize:11,fontWeight:700,color:selGroup.color}}>{selGroup.name}</div>
              <div style={{fontSize:10,color:c.muted,marginTop:2}}>{selGroup.description}</div>
            </div>
          )}

          {/* 検索 */}
          <div style={{padding:"8px 12px",flexShrink:0}}>
            <input value={filter==="◎"?"":filter} onChange={e=>setFilter(e.target.value)} placeholder="企業名を検索（全グループ）..."
              style={{width:"100%",padding:"6px 10px",borderRadius:7,border:"1px solid "+c.border,background:c.bg2,color:c.text,fontSize:12,outline:"none",boxSizing:"border-box"}}/>
          </div>

          {/* 企業リスト */}
          <div style={{flex:1,overflowY:"auto",padding:"0 8px 8px"}}>
  {visibleCompanies.map(co=>{
  const sel     = company?.id===co.id;
  const isCached= cachedIds.includes(co.id);
  const grp     = groups.find(g=>g.id===co.group_id);
  const stats   = patentStats[co.id]; // ★ 追加

  return (
    <div key={co.id} onClick={()=>selectCompany(co)}
      style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",borderRadius:7,marginBottom:2,cursor:"pointer",background:sel?"#0c2d42":"transparent",border:"1px solid "+(sel?groupColor:"transparent")}}>
      <span style={{fontSize:13,flexShrink:0}}>{co.flag||"🏢"}</span>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:12,fontWeight:sel?700:400,color:sel?groupColor:c.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{co.name}</div>
        <div style={{fontSize:10,color:c.muted,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{co.sector}</div>
        {/* ★ 追加：特許取得期間 */}
        {stats ? (
          <div style={{fontSize:9,color:sel?groupColor:c.muted,marginTop:2,display:"flex",gap:4,alignItems:"center"}}>
            <span>{stats.oldest_date?.slice(0,7)}</span>
            <span>〜</span>
            <span>{stats.newest_date?.slice(0,7)}</span>
            <span style={{opacity:.6}}>({Number(stats.patent_count).toLocaleString()}件)</span>
          </div>
        ) : (
          <div style={{fontSize:9,color:c.muted,opacity:.5,marginTop:2}}>未取得</div>
        )}
        {filter&&grp&&<div style={{fontSize:9,color:grp.color,marginTop:1}}>{grp.name}</div>}
      </div>
      {isCached&&!sel&&<div style={{width:5,height:5,borderRadius:"50%",background:c.green,flexShrink:0}}/>}
      {sel&&<div style={{width:5,height:5,borderRadius:"50%",background:groupColor,flexShrink:0}}/>}
    </div>
  );
})}
          </div>
        </div>

        {/* メインエリア */}
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>

          {/* コントロールバー */}
          <div style={{padding:"10px 16px",borderBottom:"1px solid "+c.border,background:c.bg1,display:"flex",alignItems:"center",gap:10,flexShrink:0,flexWrap:"wrap"}}>
            {company ? (
  <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
    <span style={{fontSize:16}}>{company.flag||"🏢"}</span>
    <span style={{fontWeight:700,fontSize:14,color:groupColor}}>{company.name}</span>
    <span style={{fontSize:11,color:c.muted,padding:"2px 6px",borderRadius:4,background:c.bg2}}>{company.sector}</span>
    {company.legal && (
      <span style={{fontSize:10,color:c.muted,padding:"2px 8px",borderRadius:4,background:c.bg2,border:"1px solid "+c.border}}>
        EPO: {Array.isArray(company.legal) ? company.legal.join(" / ") : company.legal}
      </span>
    )}
  </div>
            ) : <span style={{fontSize:13,color:c.muted}}>← 企業を選択してください</span>}
            <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              <label style={{fontSize:11,color:c.muted}}>開始</label>
              <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} style={{padding:"4px 8px",borderRadius:5,border:"1px solid "+c.border,background:c.bg2,color:c.text,fontSize:12,outline:"none"}}/>
              <label style={{fontSize:11,color:c.muted}}>終了</label>
              <input type="date" value={dateTo}   onChange={e=>setDateTo(e.target.value)}   style={{padding:"4px 8px",borderRadius:5,border:"1px solid "+c.border,background:c.bg2,color:c.text,fontSize:12,outline:"none"}}/>
              <button onClick={doFetch} disabled={!company||phase==="fetching"}
                style={{padding:"8px 20px",borderRadius:7,border:"none",cursor:!company||phase==="fetching"?"not-allowed":"pointer",fontWeight:700,fontSize:13,background:!company||phase==="fetching"?"#1a3550":c.amber,color:!company||phase==="fetching"?c.muted:"#000",flexShrink:0}}>
                {phase==="fetching"?"取得中...":"特許を取得"}
              </button>
              {patents.length>0&&company&&cachedIds.includes(company.id)&&(
                <button onClick={()=>{deleteFromLS(company.id);setCachedIds(getCachedIds());setErr("");setPatents([]);setPhase("idle");}}
                  style={{padding:"8px 12px",borderRadius:7,border:"1px solid "+c.border,background:"transparent",color:c.muted,fontSize:12,cursor:"pointer",flexShrink:0}}>
                  キャッシュ削除
                </button>
              )}
            </div>
          </div>

          {dbStatus&&<div style={{padding:"5px 16px",background:dbStatus.includes("完了")?"#0a1e0a":"#1a1200",borderBottom:"1px solid "+(dbStatus.includes("完了")?"#14532d":"#3d2a00"),fontSize:11,color:dbStatus.includes("完了")?c.green:c.amber}}>{dbStatus}</div>}
          {err&&<div style={{padding:"8px 16px",background:"#1a1000",borderBottom:"1px solid #3d2a00",fontSize:12,color:c.amber}}>{err}</div>}

          <div style={{flex:1,overflowY:"auto",padding:16}}>
            {phase==="idle"&&!patents.length&&(
              <div style={{textAlign:"center",paddingTop:80,color:c.muted}}>
                <div style={{fontSize:40,marginBottom:16}}>📡</div>
                <div style={{fontSize:16,fontWeight:700,color:c.text,marginBottom:8}}>特許データ取得</div>
                <div style={{fontSize:13,lineHeight:2,marginBottom:24}}>
                  左のグループタブから企業を選択し<br/>期間を設定して「特許を取得」を押してください
                </div>
                <div style={{display:"inline-block",textAlign:"left",fontSize:11,lineHeight:2.2,padding:"14px 20px",background:c.bg1,borderRadius:10,border:"1px solid "+c.border}}>
                  <div>✅ 取得対象: <strong style={{color:c.cyan}}>US</strong> / <strong style={{color:c.green}}>WO</strong> / <strong style={{color:c.amber}}>JP</strong> 特許</div>
                  <div>✅ 最大 2,000 件まで取得</div>
                  <div>✅ 取得データは Supabase DB に自動保存</div>
                  <div>📊 分析・解説は <strong style={{color:c.purple}}>ダッシュボード</strong> から</div>
                </div>
              </div>
            )}

            {patents.length>0&&(
              <>
                <div style={{...card,marginBottom:14,display:"flex",gap:16,alignItems:"center",flexWrap:"wrap"}}>
                  <div><div style={{fontSize:11,color:c.muted,marginBottom:2}}>EPO総件数</div><div style={{fontSize:28,fontWeight:700,color:groupColor,fontFamily:"monospace"}}>{total.toLocaleString()}</div></div>
                  <div style={{width:1,height:40,background:c.border}}/>
                  <div>
                    <div style={{fontSize:11,color:c.muted,marginBottom:6}}>国別内訳</div>
                    <div style={{display:"flex",gap:12}}>
                      {TARGET_COUNTRIES.map(ct=>(<div key={ct}><span style={{fontSize:14,fontWeight:700,color:COUNTRY_COLORS[ct]}}>{ct}: </span><span style={{fontSize:14,fontWeight:700,color:c.text}}>{patents.filter(p=>p.country===ct).length}</span></div>))}
                    </div>
                  </div>
                  <div style={{marginLeft:"auto"}}>
                    <button onClick={()=>setShowDashboard(true)} style={{padding:"10px 20px",borderRadius:8,border:"none",background:c.purple,color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                      📊 ダッシュボードで分析する →
                    </button>
                  </div>
                </div>

                <div style={card}>
                  <div style={{fontSize:11,color:c.muted,marginBottom:10}}>取得済み特許一覧（{patents.length}件）</div>
                  {patents.map((p,i)=>{
                    const ctryColor=COUNTRY_COLORS[p.country]||"#94a3b8";
                    const url="https://worldwide.espacenet.com/patent/search?q=pn%3D"+encodeURIComponent(p.patent_number);
                    return (
                      <div key={p.patent_number+i} style={{padding:"10px 8px",borderBottom:"1px solid "+c.border,display:"flex",gap:10,alignItems:"flex-start"}}>
                        <span style={{fontSize:10,color:c.muted,minWidth:28,fontFamily:"monospace",paddingTop:3}}>{String(i+1).padStart(3,"0")}</span>
                        <span style={{fontSize:10,fontWeight:700,color:ctryColor,padding:"1px 6px",borderRadius:3,border:"1px solid "+ctryColor,background:"#030b14",flexShrink:0,marginTop:2}}>{p.country}</span>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:12,color:c.text,lineHeight:1.4,marginBottom:3}}>{p.patent_title}</div>
                          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                            <span style={{fontSize:10,color:c.muted,fontFamily:"monospace"}}>{p.patent_number} · {p.patent_date}</span>
                            {p.inventors&&p.inventors.length>0&&<span style={{fontSize:10,color:c.muted}}>👤 {p.inventors.slice(0,3).join(" / ")}{p.inventors.length>3?" 他"+(p.inventors.length-3)+"名":""}</span>}
                            <a href={url} target="_blank" rel="noopener noreferrer" style={{fontSize:10,color:c.cyan,textDecoration:"none",padding:"1px 6px",borderRadius:4,border:"1px solid "+c.border,background:c.bg2}}>Espacenet →</a>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      <style>{`input[type=date]::-webkit-calendar-picker-indicator{filter:invert(0.6);}::-webkit-scrollbar{width:6px;}::-webkit-scrollbar-track{background:transparent;}::-webkit-scrollbar-thumb{background:#1a3550;border-radius:3px;}`}</style>
    </div>
  );
}
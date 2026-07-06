import { useState, useEffect, useMemo, useCallback } from "react";

// =============================================================================
// PaperExplorer v4 — 特許UIに完全準拠(AND/OR/NOT検索, AI解説/分析)
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
  const [aiPhase, setAiPhase]       = useState("idle");
  const [aiResult, setAiResult]     = useState(null);
  // AI分析(バッチ)
  const [analyzePhase, setAnalyzePhase] = useState("idle");
  const [analysis, setAnalysis]         = useState(null);
  const [showAnalysis, setShowAnalysis] = useState(true);

  const GROUP_LABELS = { group_west:"欧米", group_china:"中国", group_japan:"日本", group_beauty:"化粧品" };
  const coMap = useMemo(() => Object.fromEntries((companies||[]).map(co=>[co.id,co])), [companies]);
  const coName = slug => coMap[slug]?.name || slug;

  // ---- Claude API ----
  const claudePost = useCallback(async (prompt, maxTokens=1500) => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST",
      headers:{"Content-Type":"application/json","x-api-key":claudeApiKey,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
      body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:maxTokens,messages:[{role:"user",content:prompt}]}),
    });
    if(!res.ok) throw new Error("Claude API error: "+res.status);
    const data = await res.json();
    return data.content?.[0]?.text||"";
  }, [claudeApiKey]);

  // ---- AND/OR/NOT パーサー → Supabase REST フィルタ ----
  const buildKeywordFilter = (raw) => {
    if (!raw.trim()) return "";
    const parts = raw.trim().split(/\s+/);
    const andTerms = [], orTerms = [], notTerms = [];
    let mode = "and";
    for (const p of parts) {
      if (p.toUpperCase() === "AND") { mode = "and"; continue; }
      if (p.toUpperCase() === "OR")  { mode = "or";  continue; }
      if (p.toUpperCase() === "NOT") { mode = "not"; continue; }
      if (mode === "or")  orTerms.push(p);
      else if (mode === "not") notTerms.push(p);
      else andTerms.push(p);
      mode = "and"; // デフォルトに戻す
    }
    const filters = [];
    for (const t of andTerms) filters.push(`or=(title.ilike.*${t}*,abstract_text.ilike.*${t}*)`);
    if (orTerms.length > 0) {
      const ors = orTerms.map(t => `title.ilike.*${t}*,abstract_text.ilike.*${t}*`).join(",");
      filters.push(`or=(${ors})`);
    }
    for (const t of notTerms) {
      filters.push(`title=not.ilike.*${t}*`);
      filters.push(`abstract_text=not.ilike.*${t}*`);
    }
    return filters.join("&");
  };

  // ---- 検索 ----
  const doSearch = useCallback(async (pg=0) => {
    setLoading(true); setErr(""); setOpenId(null); setAiResult(null); setAiPhase("idle");
    setPage(pg);
    let filterParts = [];
    const kwFilter = buildKeywordFilter(keyword);
    if (kwFilter) filterParts.push(kwFilter);
    if (companySlug) filterParts.push(`company_slug=eq.${companySlug}`);
    if (yearFilter) filterParts.push(`publication_year=eq.${yearFilter}`);
    const orderCol = sortBy==="year" ? "publication_year.desc,cited_by_count.desc" : "cited_by_count.desc,publication_year.desc";
    const qs = [`select=openalex_id,doi,title,publication_year,cited_by_count,is_oa,oa_url,source_name,type,company_slug,abstract_text,topics`,
      ...filterParts, `order=${orderCol}`, `limit=${PAGE_SIZE}`, `offset=${pg*PAGE_SIZE}`].join("&");
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/papers_search?${qs}`, {
        headers:{apikey:supabaseKey,Authorization:`Bearer ${supabaseKey}`,"Accept-Profile":"openalex",Prefer:"count=estimated"}
      });
      const cr=res.headers.get("content-range"); if(cr){const m=cr.match(/\/(\d+)/); if(m) setTotalCount(parseInt(m[1]));}
      const data=await res.json(); setResults(Array.isArray(data)?data:[]);
    } catch(e){setErr("検索エラー: "+e.message); setResults([]);}
    setLoading(false);
  }, [keyword,companySlug,yearFilter,sortBy,supabaseUrl,supabaseKey]);

  useEffect(()=>{doSearch(0);},[]);

  const parseTopics = raw => { if(!raw) return []; try{const p=typeof raw==="string"?JSON.parse(raw):raw;return Array.isArray(p)?p:[];}catch{return[];} };

  // ---- AI解説(個別: タイトル日本語訳 + 要約日本語訳) ----
  const doAiExplain = async (paper) => {
    setAiPhase("loading"); setAiResult(null);
    try {
      const text = await claudePost(
        `以下の英語論文のタイトルと要約を日本語に翻訳してください。\n\n`
        +`【原題】${paper.title}\n\n`
        +`【Abstract】\n${paper.abstract_text||"(なし)"}\n\n`
        +`以下の形式で回答してください:\n`
        +`TITLE_JA:（日本語タイトル）\n`
        +`ABSTRACT_JA:（日本語要約）`, 2000
      );
      setAiResult(text); setAiPhase("done");
    } catch(e){setErr("AI解説エラー: "+e.message); setAiPhase("idle");}
  };

  // AI解説の解析
  const parseAiExplain = (text) => {
    if (!text) return { titleJa:"", abstractJa:"" };
    const getV = p => { const lines = text.split("\n"); const l = lines.find(l => l.startsWith(p)); return l ? l.slice(p.length).trim() : ""; };
    let titleJa = getV("TITLE_JA:");
    let abstractJa = getV("ABSTRACT_JA:");
    // ABSTRACT_JA: の後に複数行ある場合は全部結合
    if (abstractJa) {
      const idx = text.indexOf("ABSTRACT_JA:");
      if (idx >= 0) abstractJa = text.slice(idx + "ABSTRACT_JA:".length).trim();
    }
    return { titleJa, abstractJa };
  };

  // ---- AI分析(バッチ: 特許と同じCAT/TREND/2050/戦略 フォーマット) ----
  const doAnalyzeResults = async () => {
    setAnalyzePhase("analyzing"); setAnalysis(null); setShowAnalysis(true);
    try {
      let filterParts = [];
      const kwFilter = buildKeywordFilter(keyword);
      if (kwFilter) filterParts.push(kwFilter);
      if (companySlug) filterParts.push(`company_slug=eq.${companySlug}`);
      if (yearFilter) filterParts.push(`publication_year=eq.${yearFilter}`);
      const qs = [`select=openalex_id,title,publication_year,cited_by_count,source_name,company_slug,abstract_text,topics`,
        ...filterParts, "order=cited_by_count.desc", "limit=500"].join("&");
      const res = await fetch(`${supabaseUrl}/rest/v1/papers_search?${qs}`, {
        headers:{apikey:supabaseKey,Authorization:`Bearer ${supabaseKey}`,"Accept-Profile":"openalex"}
      });
      const allPapers = await res.json();
      if (!allPapers.length) { setErr("分析対象の論文がありません"); setAnalyzePhase("idle"); return; }

      const filterDesc = [keyword?`キーワード: "${keyword}"`:null, companySlug?`企業: ${coName(companySlug)}`:null, yearFilter?`年: ${yearFilter}`:null].filter(Boolean).join(" / ")||"フィルターなし";

      const BATCH=50;
      const batches=[]; for(let i=0;i<allPapers.length;i+=BATCH) batches.push(allPapers.slice(i,i+BATCH));
      const batchResults=[];

      for(let b=0;b<batches.length;b++){
        setAnalysis(prev=>({...(prev||{}),_progress:{done:b,total:batches.length,phase:"batch"}}));
        const batch=batches[b];
        const list=batch.map((p,i)=>{
          const abs=(p.abstract_text||"").split(/\s+/).slice(0,80).join(" ");
          return `${i+1}. [${p.publication_year}] ${p.title} — ${coName(p.company_slug)} (cited:${p.cited_by_count})\n   ${abs}`;
        }).join("\n");

        const bText=await claudePost(
          "You are a research intelligence analyst. Analyze this batch of academic papers and extract key technology patterns. Reply ONLY in this exact format:\n"
          +"BCAT1:category name|percentage|one line description\nBCAT2:category name|percentage|one line description\nBCAT3:category name|percentage|one line description\nBCAT4:category name|percentage|one line description\nBCAT5:category name|percentage|one line description\n"
          +"BTREND1:trend title|2 sentence explanation in Japanese\nBTREND2:trend title|2 sentence explanation in Japanese\nBTREND3:trend title|2 sentence explanation in Japanese\n"
          +"BNOTABLE:notable paper title and innovation in Japanese (2 sentences)\n\n"
          +"Batch "+(b+1)+"/"+batches.length+" ("+batch.length+" of "+allPapers.length+" papers):\n"+list, 1200
        );
        const getV=p=>{const l=bText.split("\n").find(l=>l.startsWith(p));return l?l.slice(p.length).trim():"";};
        const parseBar=p=>{const pts=getV(p).split("|");return{name:pts[0]||"",pct:parseInt(pts[1]||"0",10),desc:pts[2]||""};};
        const parseTrend=p=>{const v=getV(p);const i=v.indexOf("|");return{title:i>=0?v.slice(0,i):v,body:i>=0?v.slice(i+1):""};};
        batchResults.push({batchNum:b+1,count:batch.length,
          categories:[parseBar("BCAT1:"),parseBar("BCAT2:"),parseBar("BCAT3:"),parseBar("BCAT4:"),parseBar("BCAT5:")].filter(c=>c.name),
          trends:[parseTrend("BTREND1:"),parseTrend("BTREND2:"),parseTrend("BTREND3:")].filter(t=>t.title),
          notable:getV("BNOTABLE:")});
        if(b<batches.length-1) await new Promise(r=>setTimeout(r,600));
      }

      setAnalysis(prev=>({...(prev||{}),_progress:{done:batches.length,total:batches.length,phase:"synthesis"}}));
      const batchSummary=batchResults.map(br=>"--- バッチ"+br.batchNum+" ("+br.count+"件) ---\nカテゴリー: "+br.categories.map(c=>c.name+"("+c.pct+"%)").join(", ")+"\nトレンド: "+br.trends.map(t=>t.title).join(" / ")+"\n注目論文: "+br.notable).join("\n\n");

      const synthText=await claudePost(
        "You are a research intelligence analyst. Based on the batch analysis below, synthesize a comprehensive report.\n\n"
        +"Total: "+allPapers.length+" papers ("+batches.length+" batches). Filter: "+filterDesc+"\n\n"
        +"Batch summaries:\n"+batchSummary+"\n\n"
        +"Reply ONLY in this exact format:\n"
        +"CAT1:category name|percentage|detailed one-line description\nCAT2:category name|percentage|detailed one-line description\nCAT3:category name|percentage|detailed one-line description\nCAT4:category name|percentage|detailed one-line description\nCAT5:category name|percentage|detailed one-line description\n"
        +"TREND1:trend title|3-4 sentence detailed explanation in Japanese\nTREND2:trend title|3-4 sentence detailed explanation in Japanese\nTREND3:trend title|3-4 sentence detailed explanation in Japanese\n"
        +"IMPACT2040:2040年の社会実装シナリオ（3-4文、日本語）\n"
        +"STRATEGIC:産業への戦略的示唆（3-4文、日本語）\n"
        +"NOTABLE:最注目論文とその革新性（2-3文、日本語）", 2500
      );

      const getV=p=>{const l=synthText.split("\n").find(l=>l.startsWith(p));return l?l.slice(p.length).trim():"";};
      const parseBar=p=>{const pts=getV(p).split("|");return{name:pts[0]||"",pct:parseInt(pts[1]||"0",10),desc:pts[2]||""};};
      const parseTrend=p=>{const v=getV(p);const i=v.indexOf("|");return{title:i>=0?v.slice(0,i):v,body:i>=0?v.slice(i+1):""};};

      setAnalysis({
        filterDesc, totalCount:allPapers.length, totalBatches:batches.length, batchResults,
        categories:[parseBar("CAT1:"),parseBar("CAT2:"),parseBar("CAT3:"),parseBar("CAT4:"),parseBar("CAT5:")].filter(c=>c.name),
        trends:[parseTrend("TREND1:"),parseTrend("TREND2:"),parseTrend("TREND3:")].filter(t=>t.title),
        impact2050:getV("IMPACT2040:"), strategic:getV("STRATEGIC:"), topPatent:getV("NOTABLE:"),
      });
      setAnalyzePhase("done");
    } catch(e){setErr("AI分析エラー: "+e.message); setAnalyzePhase("idle");}
  };

  const totalPages=Math.ceil(totalCount/PAGE_SIZE);

  return (
    <div style={{display:"flex",flex:1,overflow:"hidden"}}>
      {/* ===== 左フィルターパネル (幅220: 特許と統一) ===== */}
      <div style={{width:220,borderRight:"1px solid "+c.border,background:c.bg1,overflowY:"auto",padding:12,flexShrink:0}}>
        <div style={{fontSize:11,fontWeight:700,color:c.muted,marginBottom:10,letterSpacing:".06em"}}>論文検索・フィルター</div>

        <div style={{marginBottom:12}}>
          <div style={{fontSize:11,color:c.muted,marginBottom:4}}>キーワード</div>
          <input value={keyword} onChange={e=>setKeyword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doSearch(0)}
            placeholder="タイトル・要約（英語）"
            style={{width:"100%",padding:"7px 10px",borderRadius:7,border:"1px solid "+c.border,background:c.bg2,color:c.text,fontSize:12,outline:"none",boxSizing:"border-box"}}/>
          <div style={{fontSize:9,color:c.muted,marginTop:4,lineHeight:1.8}}>
            <span style={{color:c.cyan}}>AND:</span> neural network　
            <span style={{color:c.green}}>OR:</span> battery OR lithium　
            <span style={{color:"#f87171"}}>NOT:</span> AI NOT image
          </div>
        </div>

        <div style={{marginBottom:12}}>
          <div style={{fontSize:11,color:c.muted,marginBottom:4}}>企業</div>
          <select value={companySlug} onChange={e=>setCompanySlug(e.target.value)}
            style={{width:"100%",padding:"7px 8px",borderRadius:7,border:"1px solid "+c.border,background:c.bg2,color:c.text,fontSize:12,cursor:"pointer",boxSizing:"border-box"}}>
            <option value="">すべて</option>
            {Object.entries(GROUP_LABELS).map(([gid,label])=>(
              <optgroup key={gid} label={label}>
                {(companies||[]).filter(co=>co.group_id===gid).map(co=>
                  <option key={co.id} value={co.id}>{co.name}</option>
                )}
              </optgroup>
            ))}
          </select>
        </div>

        <div style={{marginBottom:12}}>
          <div style={{fontSize:11,color:c.muted,marginBottom:4}}>発行年</div>
          <select value={yearFilter} onChange={e=>setYearFilter(e.target.value)}
            style={{width:"100%",padding:"7px 8px",borderRadius:7,border:"1px solid "+c.border,background:c.bg2,color:c.text,fontSize:12,cursor:"pointer",boxSizing:"border-box"}}>
            <option value="">すべて</option>
            {[2026,2025,2024,2023,2022].map(y=><option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        <div style={{marginBottom:14}}>
          <div style={{fontSize:11,color:c.muted,marginBottom:4}}>並び順</div>
          <select value={sortBy} onChange={e=>setSortBy(e.target.value)}
            style={{width:"100%",padding:"7px 8px",borderRadius:7,border:"1px solid "+c.border,background:c.bg2,color:c.text,fontSize:12,cursor:"pointer",boxSizing:"border-box"}}>
            <option value="cited_by_count">被引用数</option>
            <option value="year">新着</option>
          </select>
        </div>

        <button onClick={()=>doSearch(0)}
          style={{width:"100%",padding:"8px 0",borderRadius:7,border:"none",background:c.cyan,color:"#000",fontWeight:700,fontSize:13,cursor:"pointer",marginBottom:6}}>
          {loading?"検索中...":"🔍 検索"}
        </button>
        <button onClick={()=>{setKeyword("");setCompanySlug("");setYearFilter("");}}
          style={{width:"100%",padding:"5px 0",borderRadius:7,border:"1px solid "+c.border,background:"transparent",color:c.muted,fontSize:11,cursor:"pointer",marginBottom:12}}>
          リセット
        </button>

        <div style={{borderTop:"1px solid "+c.border,paddingTop:10}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{fontSize:12,fontWeight:700,color:c.cyan}}>{totalCount.toLocaleString()} 件</span>
          </div>
          {totalCount>0 && (
            <button onClick={doAnalyzeResults} disabled={analyzePhase==="analyzing"}
              style={{width:"100%",padding:"8px 0",borderRadius:7,border:"none",
                background:analyzePhase==="analyzing"?c.bg3:c.amber,color:analyzePhase==="analyzing"?c.muted:"#000",
                fontWeight:700,fontSize:12,cursor:"pointer"}}>
              {analyzePhase==="analyzing"?"🤖 分析中...":"🤖 AI分析（特許準拠）"}
            </button>
          )}
        </div>
      </div>

      {/* ===== 右: 結果エリア ===== */}
      <div style={{flex:1,overflowY:"auto",padding:"10px 16px"}}>
        {err && <div style={{padding:"8px 12px",background:"#1a1000",borderRadius:6,fontSize:11,color:c.amber,marginBottom:10}}>{err}</div>}

        {/* AI分析プログレス */}
        {analysis?._progress && analyzePhase==="analyzing" && (
          <div style={{...card,marginBottom:14,border:"1px solid "+c.amber}}>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:c.amber,marginBottom:6}}>
              <span>{analysis._progress.phase==="synthesis"?"統合分析中...":"バッチ分析中..."}</span>
              <span>{analysis._progress.done}/{analysis._progress.total}バッチ</span>
            </div>
            <div style={{height:5,background:c.bg2,borderRadius:3,overflow:"hidden"}}>
              <div style={{height:"100%",background:"linear-gradient(90deg,"+c.amber+",#fbbf24)",borderRadius:3,
                width:(analysis._progress.phase==="synthesis"?"100%":(analysis._progress.done/analysis._progress.total*100)+"%"),transition:"width .4s"}}/>
            </div>
          </div>
        )}

        {/* AI分析結果(特許と同じ構造) */}
        {analysis && analysis.categories && analyzePhase==="done" && showAnalysis && (
          <div style={{background:c.bg1,borderRadius:10,border:"1px solid "+c.amber,marginBottom:16,overflow:"hidden"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 14px",background:"#1a1200",borderBottom:"1px solid "+c.border,flexWrap:"wrap"}}>
              <span style={{fontSize:12,fontWeight:700,color:c.amber}}>🤖 AI研究動向分析</span>
              <span style={{fontSize:11,color:c.cyan,padding:"1px 7px",borderRadius:4,background:"#0c2d42",border:"1px solid "+c.border}}>{analysis.totalCount}件</span>
              {analysis.totalBatches>1 && <span style={{fontSize:11,color:c.green,padding:"1px 7px",borderRadius:4,background:"#0a1e0a",border:"1px solid "+c.green}}>{analysis.totalBatches}バッチ</span>}
              <span style={{fontSize:11,color:c.muted}}>{analysis.filterDesc}</span>
              <button onClick={()=>setShowAnalysis(false)} style={{marginLeft:"auto",fontSize:11,color:c.muted,background:"transparent",border:"none",cursor:"pointer"}}>▲ 閉じる</button>
            </div>
            <div style={{padding:14,display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div>
                <div style={{fontSize:11,fontWeight:700,color:c.cyan,marginBottom:8}}>研究テーマ分類</div>
                {analysis.categories.map((cat,i)=>(
                  <div key={i} style={{marginBottom:8}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:11,color:c.text}}>{cat.name}</span><span style={{fontSize:11,color:c.cyan,fontWeight:700}}>{cat.pct}%</span></div>
                    <div style={{height:5,background:c.bg2,borderRadius:3,overflow:"hidden",marginBottom:2}}><div style={{height:"100%",width:cat.pct+"%",background:"linear-gradient(90deg,"+c.cyan+",#7dd3fc)",borderRadius:3}}/></div>
                    <div style={{fontSize:10,color:c.muted}}>{cat.desc}</div>
                  </div>
                ))}
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <div>
                  <div style={{fontSize:11,fontWeight:700,color:c.amber,marginBottom:6}}>主要研究トレンド</div>
                  {analysis.trends.map((t,i)=>(
                    <div key={i} style={{marginBottom:8,paddingLeft:8,borderLeft:"2px solid "+c.amber}}>
                      <div style={{fontSize:11,fontWeight:600,color:c.text,marginBottom:2}}>{t.title}</div>
                      <div style={{fontSize:10,color:c.muted,lineHeight:1.6}}>{t.body}</div>
                    </div>
                  ))}
                </div>
                <div style={{padding:"8px 10px",background:c.bg2,borderRadius:6}}>
                  <div style={{fontSize:10,fontWeight:700,color:c.green,marginBottom:4}}>2040年 社会実装シナリオ</div>
                  <div style={{fontSize:11,color:c.text,lineHeight:1.65}}>{analysis.impact2050}</div>
                </div>
                <div style={{padding:"8px 10px",background:c.bg2,borderRadius:6}}>
                  <div style={{fontSize:10,fontWeight:700,color:c.purple,marginBottom:4}}>産業への戦略的示唆</div>
                  <div style={{fontSize:11,color:c.text,lineHeight:1.65}}>{analysis.strategic}</div>
                </div>
                {analysis.topPatent && (
                  <div style={{padding:"8px 10px",background:c.bg2,borderRadius:6,border:"1px solid "+c.cyan}}>
                    <div style={{fontSize:10,color:c.cyan,marginBottom:3}}>★ 最注目論文</div>
                    <div style={{fontSize:11,color:c.text,lineHeight:1.5}}>{analysis.topPatent}</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        {analysis && analysis.categories && !showAnalysis && (
          <button onClick={()=>setShowAnalysis(true)} style={{width:"100%",padding:"6px",borderRadius:6,border:"1px solid "+c.amber,background:"transparent",color:c.amber,fontSize:11,cursor:"pointer",marginBottom:12}}>
            ▼ AI分析結果を表示する
          </button>
        )}

        <div style={{fontSize:11,color:c.muted,marginBottom:12}}>
          {loading?"検索中...":totalCount.toLocaleString()+"件 / "+totalPages+"ページ中 "+(page+1)+"ページ"}
        </div>

        {results.length===0 && !loading && <div style={{padding:60,textAlign:"center",color:c.muted,fontSize:14}}>検索条件に一致する論文がありません</div>}

        {results.map((r,idx)=>{
          const topics=parseTopics(r.topics);
          const isOpen=openId===r.openalex_id;
          const parsed = isOpen && aiPhase==="done" && aiResult ? parseAiExplain(aiResult) : null;
          return (
            <div key={r.openalex_id+"_"+idx} style={{...card,marginBottom:10,border:"1px solid "+(isOpen?c.purple:c.border)}}>
              <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                <span style={{fontSize:10,fontWeight:700,color:c.green,padding:"1px 6px",borderRadius:3,border:"1px solid "+c.green,background:c.bg0,flexShrink:0,marginTop:2}}>{r.publication_year}</span>
                <div style={{flex:1,minWidth:0}}>
                  {/* タイトル */}
                  <div style={{fontSize:13,color:"#e2e8f0",lineHeight:1.4,marginBottom:3,cursor:"pointer"}}
                    onClick={()=>{setOpenId(isOpen?null:r.openalex_id);setAiPhase("idle");setAiResult(null);}}>
                    {r.title||"(タイトルなし)"}
                  </div>
                  {/* AI日本語タイトル */}
                  {parsed?.titleJa && <div style={{fontSize:13,fontWeight:600,color:c.purple,marginBottom:5}}>{parsed.titleJa}</div>}

                  {/* メタ情報 */}
                  <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:6}}>
                    <span style={{fontSize:11,color:c.cyan,padding:"1px 6px",borderRadius:4,background:"#0c2d42",border:"1px solid "+c.border}}>{coName(r.company_slug)}</span>
                    <span style={{fontSize:11,color:c.muted,fontFamily:"monospace"}}>被引用 {(r.cited_by_count||0).toLocaleString()}</span>
                    {r.is_oa && <span style={{fontSize:9,color:"#4ade80",padding:"1px 6px",borderRadius:3,border:"1px solid #4ade80"}}>OA</span>}
                    {r.source_name && <span style={{fontSize:10,color:c.muted,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.source_name}</span>}
                  </div>

                  {/* トピックバッジ */}
                  {topics.length>0 && (
                    <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:6}}>
                      {topics.slice(0,3).map((t,i)=><span key={i} style={{fontSize:9,padding:"1px 6px",borderRadius:3,border:"1px solid "+c.border,color:c.muted}}>{t.display_name}</span>)}
                    </div>
                  )}

                  {/* 展開時 */}
                  {isOpen && (
                    <>
                      {/* リンク・AIボタン */}
                      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
                        {r.oa_url && <a href={r.oa_url} target="_blank" rel="noreferrer" style={{fontSize:11,padding:"3px 10px",borderRadius:5,background:"#059669",color:"#fff",textDecoration:"none",fontWeight:600}}>📖 全文を読む</a>}
                        {r.doi && <a href={`https://doi.org/${r.doi}`} target="_blank" rel="noreferrer" style={{fontSize:11,padding:"3px 10px",borderRadius:5,border:"1px solid "+c.border,background:c.bg2,color:c.cyan,textDecoration:"none"}}>🔗 DOI</a>}
                        <a href={`https://openalex.org/${r.openalex_id}`} target="_blank" rel="noreferrer" style={{fontSize:11,padding:"3px 10px",borderRadius:5,border:"1px solid "+c.border,background:c.bg2,color:c.muted,textDecoration:"none"}}>OpenAlex</a>
                        <button onClick={()=>doAiExplain(r)} disabled={aiPhase==="loading"}
                          style={{fontSize:11,padding:"3px 10px",borderRadius:5,border:"none",background:aiPhase==="loading"?c.bg3:"#e879f9",color:aiPhase==="loading"?c.muted:"#000",fontWeight:600,cursor:"pointer"}}>
                          {aiPhase==="loading"?"⏳ 翻訳中...":"✨ AI解説(日本語訳)"}
                        </button>
                      </div>

                      {/* Abstract(英語) */}
                      {r.abstract_text && (
                        <div style={{fontSize:11,color:c.muted,lineHeight:1.7,padding:"6px 10px",background:"#0a1e0a",borderRadius:5,borderLeft:"3px solid "+c.amber,marginBottom:8}}>
                          <div style={{fontSize:10,color:c.amber,fontWeight:600,marginBottom:3}}>Abstract</div>
                          {r.abstract_text}
                        </div>
                      )}

                      {/* AI解説(日本語訳) */}
                      {parsed?.abstractJa && (
                        <div style={{fontSize:12,color:c.text,lineHeight:1.8,padding:"8px 12px",background:c.bg2,borderRadius:6,borderLeft:"3px solid #e879f9",marginBottom:8}}>
                          <div style={{fontSize:10,color:"#e879f9",fontWeight:600,marginBottom:3}}>AI解説（日本語訳）</div>
                          {parsed.abstractJa}
                        </div>
                      )}
                    </>
                  )}

                  <button onClick={()=>{setOpenId(isOpen?null:r.openalex_id);setAiPhase("idle");setAiResult(null);}}
                    style={{fontSize:11,padding:"3px 10px",borderRadius:5,border:"1px solid "+(isOpen?c.purple:c.border),background:isOpen?"#0d0820":"transparent",color:isOpen?c.purple:c.muted,cursor:"pointer",marginTop:4}}>
                    {isOpen?"▼ 閉じる":"▶ 詳細を表示"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {totalPages>1 && (
          <div style={{display:"flex",justifyContent:"center",gap:8,marginTop:16}}>
            <button onClick={()=>doSearch(page-1)} disabled={page===0} style={{padding:"6px 14px",borderRadius:6,border:"1px solid "+c.border,background:"transparent",color:page===0?c.muted:c.text,cursor:page===0?"not-allowed":"pointer"}}>← 前</button>
            <span style={{padding:"6px 14px",fontSize:12,color:c.muted}}>{page+1} / {totalPages}</span>
            <button onClick={()=>doSearch(page+1)} disabled={page>=totalPages-1} style={{padding:"6px 14px",borderRadius:6,border:"1px solid "+c.border,background:"transparent",color:page>=totalPages-1?c.muted:c.text,cursor:page>=totalPages-1?"not-allowed":"pointer"}}>次 →</button>
          </div>
        )}
      </div>
    </div>
  );
}

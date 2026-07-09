import { useState, useEffect, useMemo, useCallback } from "react";

// =============================================================================
// PaperExplorer v5 — AI解説修正 + DB保存 + CSV + AI分析保存 + PDF
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
  const [openId, setOpenId]         = useState(null);
  const [aiPhase, setAiPhase]       = useState("idle");
  const [aiResult, setAiResult]     = useState(null); // {titleJa, abstractJa}
  const [analyzePhase, setAnalyzePhase] = useState("idle");
  const [analysis, setAnalysis]     = useState(null);
  const [showAnalysis, setShowAnalysis] = useState(true);

  const GROUP_LABELS = {group_west:"欧米",group_china:"中国",group_japan:"日本",group_beauty:"化粧品"};
  const coMap = useMemo(()=>Object.fromEntries((companies||[]).map(co=>[co.id,co])),[companies]);
  const coName = slug => coMap[slug]?.name||slug;

  const claudePost = useCallback(async(prompt,maxTokens=2000)=>{
    const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",
      headers:{"Content-Type":"application/json","x-api-key":claudeApiKey,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
      body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:maxTokens,messages:[{role:"user",content:prompt}]})});
    if(!res.ok) throw new Error("Claude API error: "+res.status);
    const data=await res.json(); return data.content?.[0]?.text||"";
  },[claudeApiKey]);

  // ---- AND/OR/NOT パーサー ----
  const buildKeywordFilter=(raw)=>{
    if(!raw.trim()) return "";
    const parts=raw.trim().split(/\s+/);
    const andT=[],orT=[],notT=[]; let mode="and";
    for(const p of parts){
      if(p.toUpperCase()==="AND"){mode="and";continue;} if(p.toUpperCase()==="OR"){mode="or";continue;} if(p.toUpperCase()==="NOT"){mode="not";continue;}
      if(mode==="or") orT.push(p); else if(mode==="not") notT.push(p); else andT.push(p); mode="and";
    }
    const f=[];
    for(const t of andT) f.push(`or=(title.ilike.*${t}*,abstract_text.ilike.*${t}*)`);
    if(orT.length>0) f.push(`or=(${orT.map(t=>`title.ilike.*${t}*,abstract_text.ilike.*${t}*`).join(",")})`);
    for(const t of notT){f.push(`title=not.ilike.*${t}*`);f.push(`abstract_text=not.ilike.*${t}*`);}
    return f.join("&");
  };

  // ---- 検索 ----
  const doSearch = useCallback(async(pg=0)=>{
    setLoading(true);setErr("");setOpenId(null);setAiResult(null);setAiPhase("idle");setPage(pg);
    let fp=[]; const kf=buildKeywordFilter(keyword); if(kf) fp.push(kf);
    if(companySlug) fp.push(`company_slug=eq.${companySlug}`);
    if(yearFilter) fp.push(`publication_year=eq.${yearFilter}`);
    const ord=sortBy==="year"?"publication_year.desc,cited_by_count.desc":"cited_by_count.desc,publication_year.desc";
    const qs=[`select=openalex_id,doi,title,title_ja,publication_year,cited_by_count,is_oa,oa_url,source_name,type,company_slug,abstract_text,abstract_ja,topics`,
      ...fp,`order=${ord}`,`limit=${PAGE_SIZE}`,`offset=${pg*PAGE_SIZE}`].join("&");
    try{
      const res=await fetch(`${supabaseUrl}/rest/v1/papers_search?${qs}`,{
        headers:{apikey:supabaseKey,Authorization:`Bearer ${supabaseKey}`,"Accept-Profile":"openalex",Prefer:"count=estimated"}});
      const cr=res.headers.get("content-range");if(cr){const m=cr.match(/\/(\d+)/);if(m) setTotalCount(parseInt(m[1]));}
      const data=await res.json();setResults(Array.isArray(data)?data:[]);
    }catch(e){setErr("検索エラー: "+e.message);setResults([]);}
    setLoading(false);
  },[keyword,companySlug,yearFilter,sortBy,supabaseUrl,supabaseKey]);

  useEffect(()=>{doSearch(0);},[]);
  const parseTopics=raw=>{if(!raw)return[];try{const p=typeof raw==="string"?JSON.parse(raw):raw;return Array.isArray(p)?p:[];}catch{return[];}};

  // ---- AI解説(タイトル日本語訳 + Abstract日本語訳) ----
  const doAiExplain = async(paper)=>{
    setAiPhase("loading");setAiResult(null);setErr("");
    try{
      const text=await claudePost(
        `あなたは学術論文の翻訳者です。以下の英語論文のタイトルと要約を正確に日本語に翻訳してください。\n\n`
        +`【原題】\n${paper.title}\n\n`
        +`【Abstract】\n${paper.abstract_text||"(要約なし)"}\n\n`
        +`以下の形式で回答してください。各セクションの後に必ず改行を入れてください:\n\n`
        +`TITLE_JA:\n（日本語タイトルをここに記述）\n\n`
        +`ABSTRACT_JA:\n（日本語要約をここに記述。原文の段落構成を維持すること）`, 2500);

      // パース: TITLE_JA: と ABSTRACT_JA: の間を抽出
      let titleJa="", abstractJa="";
      const titleMatch=text.match(/TITLE_JA:\s*\n?([\s\S]*?)(?=\n\s*ABSTRACT_JA:)/i);
      if(titleMatch) titleJa=titleMatch[1].trim();
      else{ const m2=text.match(/TITLE_JA:\s*(.+)/i); if(m2) titleJa=m2[1].trim(); }
      const absMatch=text.match(/ABSTRACT_JA:\s*\n?([\s\S]*?)$/i);
      if(absMatch) abstractJa=absMatch[1].trim();
      // フォールバック
      if(!titleJa && !abstractJa) abstractJa=text;

      setAiResult({titleJa, abstractJa});
      setAiPhase("done");

      // ローカル結果も更新（先に更新してUIに反映）
      if(titleJa||abstractJa){
        setResults(prev=>prev.map(r=>r.openalex_id===paper.openalex_id?{...r,title_ja:titleJa||r.title_ja,abstract_ja:abstractJa||r.abstract_ja}:r));
      }

      // DB保存（非同期で実行、結果はユーザーに通知）
      if(titleJa||abstractJa){
        const patch={}; if(titleJa) patch.title_ja=titleJa; if(abstractJa) patch.abstract_ja=abstractJa;
        try{
          console.log("🔍 DB保存開始:", {openalex_id: paper.openalex_id, patch});
          const saveRes=await fetch(`${supabaseUrl}/rest/v1/works?openalex_id=eq.${paper.openalex_id}`,{
            method:"PATCH",
            headers:{apikey:supabaseKey,Authorization:`Bearer ${supabaseKey}`,"Content-Type":"application/json","Prefer":"return=representation","Accept-Profile":"openalex"},
            body:JSON.stringify(patch)
          });
          const saveBody=await saveRes.text();
          console.log("📤 DB保存レスポンス:", {status: saveRes.status, body: saveBody});

          if(saveRes.ok){
            const updated=JSON.parse(saveBody);
            if(Array.isArray(updated)&&updated.length>0){
              setErr("✅ AI解説をDBに保存しました ("+updated.length+"行更新)");
            } else {
              setErr("⚠️ 更新対象がありません。openalex_id を確認してください");
              console.warn("更新されなかった。openalex_id:", paper.openalex_id);
            }
          } else {
            setErr("⚠️ DB保存失敗 ("+saveRes.status+"): "+saveBody.slice(0,150));
            console.error("DB保存失敗:", saveRes.status, saveBody);
          }
        }catch(saveErr){
          setErr("⚠️ DB保存エラー: "+saveErr.message);
          console.error("DB保存エラー:", saveErr);
        }
      }
    }catch(e){setErr("AI解説エラー: "+e.message);setAiPhase("idle");}
  };

  // ---- CSV保存 ----
  const downloadCSV=()=>{
    if(!results.length) return;
    const header="OpenAlex ID,DOI,英語タイトル,日本語タイトル,発行年,企業,被引用数,OA,掲載誌,OA URL,Abstract,日本語要約";
    const rows=results.map(p=>[
      p.openalex_id, p.doi||"",
      '"'+(p.title||"").replace(/"/g,'""')+'"',
      '"'+(p.title_ja||"").replace(/"/g,'""')+'"',
      p.publication_year, '"'+coName(p.company_slug)+'"',
      p.cited_by_count||0, p.is_oa?"Yes":"No",
      '"'+(p.source_name||"").replace(/"/g,'""')+'"',
      p.oa_url||"",
      '"'+(p.abstract_text||"").slice(0,500).replace(/"/g,'""')+'"',
      '"'+(p.abstract_ja||"").slice(0,500).replace(/"/g,'""')+'"',
    ].join(","));
    const blob=new Blob(["\uFEFF",[header,...rows].join("\n")],{type:"text/csv;charset=utf-8;"});
    const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download="papers_search_results.csv";link.click();
  };

  // ---- AI分析(バッチ: 特許準拠フォーマット) ----
  const doAnalyzeResults=async()=>{
    setAnalyzePhase("analyzing");setAnalysis(null);setShowAnalysis(true);
    try{
      let fp=[];const kf=buildKeywordFilter(keyword);if(kf) fp.push(kf);
      if(companySlug) fp.push(`company_slug=eq.${companySlug}`);
      if(yearFilter) fp.push(`publication_year=eq.${yearFilter}`);
      const qs=[`select=openalex_id,title,publication_year,cited_by_count,source_name,company_slug,abstract_text,topics`,
        ...fp,"order=cited_by_count.desc","limit=500"].join("&");
      const res=await fetch(`${supabaseUrl}/rest/v1/papers_search?${qs}`,{
        headers:{apikey:supabaseKey,Authorization:`Bearer ${supabaseKey}`,"Accept-Profile":"openalex"}});
      const allPapers=await res.json();
      if(!allPapers.length){setErr("分析対象の論文がありません");setAnalyzePhase("idle");return;}

      const filterDesc=[keyword?`キーワード: "${keyword}"`:null,companySlug?`企業: ${coName(companySlug)}`:null,yearFilter?`年: ${yearFilter}`:null].filter(Boolean).join(" / ")||"フィルターなし";
      const BATCH=50;const batches=[];for(let i=0;i<allPapers.length;i+=BATCH) batches.push(allPapers.slice(i,i+BATCH));
      const batchResults=[];

      for(let b=0;b<batches.length;b++){
        setAnalysis(prev=>({...(prev||{}),_progress:{done:b,total:batches.length,phase:"batch"}}));
        const batch=batches[b];
        const list=batch.map((p,i)=>{const abs=(p.abstract_text||"").split(/\s+/).slice(0,80).join(" ");
          return`${i+1}. [${p.publication_year}] ${p.title} — ${coName(p.company_slug)} (cited:${p.cited_by_count})\n   ${abs}`;}).join("\n");
        const bText=await claudePost(
          "You are a research intelligence analyst. Analyze this batch of academic papers. Reply ONLY in this exact format:\n"
          +"BCAT1:category name|percentage|one line description\nBCAT2:category name|percentage|one line description\nBCAT3:category name|percentage|one line description\nBCAT4:category name|percentage|one line description\nBCAT5:category name|percentage|one line description\n"
          +"BTREND1:trend title|2 sentence explanation in Japanese\nBTREND2:trend title|2 sentence explanation in Japanese\nBTREND3:trend title|2 sentence explanation in Japanese\n"
          +"BNOTABLE:notable paper title and innovation in Japanese (2 sentences)\n\n"
          +"Batch "+(b+1)+"/"+batches.length+" ("+batch.length+" of "+allPapers.length+" papers):\n"+list,1200);
        const getV=p=>{const l=bText.split("\n").find(l=>l.startsWith(p));return l?l.slice(p.length).trim():"";};
        const parseBar=p=>{const pts=getV(p).split("|");return{name:pts[0]||"",pct:parseInt(pts[1]||"0",10),desc:pts[2]||""};};
        const parseTrend=p=>{const v=getV(p);const i=v.indexOf("|");return{title:i>=0?v.slice(0,i):v,body:i>=0?v.slice(i+1):""};};
        batchResults.push({batchNum:b+1,count:batch.length,
          categories:[parseBar("BCAT1:"),parseBar("BCAT2:"),parseBar("BCAT3:"),parseBar("BCAT4:"),parseBar("BCAT5:")].filter(x=>x.name),
          trends:[parseTrend("BTREND1:"),parseTrend("BTREND2:"),parseTrend("BTREND3:")].filter(x=>x.title),notable:getV("BNOTABLE:")});
        if(b<batches.length-1) await new Promise(r=>setTimeout(r,600));
      }

      setAnalysis(prev=>({...(prev||{}),_progress:{done:batches.length,total:batches.length,phase:"synthesis"}}));
      const batchSummary=batchResults.map(br=>"--- バッチ"+br.batchNum+" ---\nカテゴリー: "+br.categories.map(x=>x.name+"("+x.pct+"%)").join(", ")+"\nトレンド: "+br.trends.map(x=>x.title).join(" / ")+"\n注目: "+br.notable).join("\n\n");
      const synthText=await claudePost(
        "Based on the batch analysis below, synthesize a comprehensive report.\nTotal: "+allPapers.length+" papers. Filter: "+filterDesc+"\n\n"+batchSummary+"\n\n"
        +"Reply ONLY:\nCAT1:name|pct|desc\nCAT2:name|pct|desc\nCAT3:name|pct|desc\nCAT4:name|pct|desc\nCAT5:name|pct|desc\n"
        +"TREND1:title|3-4 sentence Japanese\nTREND2:title|3-4 sentence Japanese\nTREND3:title|3-4 sentence Japanese\n"
        +"IMPACT2040:2040年シナリオ(3-4文日本語)\nSTRATEGIC:戦略的示唆(3-4文日本語)\nNOTABLE:最注目論文(2-3文日本語)",2500);
      const getV=p=>{const l=synthText.split("\n").find(l=>l.startsWith(p));return l?l.slice(p.length).trim():"";};
      const parseBar=p=>{const pts=getV(p).split("|");return{name:pts[0]||"",pct:parseInt(pts[1]||"0",10),desc:pts[2]||""};};
      const parseTrend=p=>{const v=getV(p);const i=v.indexOf("|");return{title:i>=0?v.slice(0,i):v,body:i>=0?v.slice(i+1):""};};

      const finalAnalysis={filterDesc,totalCount:allPapers.length,totalBatches:batches.length,batchResults,
        categories:[parseBar("CAT1:"),parseBar("CAT2:"),parseBar("CAT3:"),parseBar("CAT4:"),parseBar("CAT5:")].filter(x=>x.name),
        trends:[parseTrend("TREND1:"),parseTrend("TREND2:"),parseTrend("TREND3:")].filter(x=>x.title),
        impact2050:getV("IMPACT2040:"),strategic:getV("STRATEGIC:"),topPatent:getV("NOTABLE:")};
      setAnalysis(finalAnalysis);setAnalyzePhase("done");

      // DB保存
      fetch(`${supabaseUrl}/rest/v1/paper_analyses`,{method:"POST",
  headers:{apikey:supabaseKey,Authorization:`Bearer ${supabaseKey}`,"Content-Type":"application/json",Prefer:"return=minimal","Content-Profile":"openalex"},
  body:JSON.stringify({filter_desc:filterDesc,total_papers:allPapers.length,
    categories:JSON.stringify(finalAnalysis.categories),trends:JSON.stringify(finalAnalysis.trends),
    impact2040:finalAnalysis.impact2050,strategic:finalAnalysis.strategic,notable:finalAnalysis.topPatent})
}).then(async res=>{
  if(res.ok){ setErr("✅ AI分析結果をDBに保存しました"); }
  else{ const t=await res.text().catch(()=>""); setErr("⚠️ DB保存失敗 ("+res.status+"): "+t); }
}).catch(e=>setErr("⚠️ DB保存エラー: "+e.message));
    }catch(e){setErr("AI分析エラー: "+e.message);setAnalyzePhase("idle");}
  };

  // ---- PDF出力 ----
  const printPDF=()=>{
    if(!analysis||!analysis.categories) return;
    const cats=analysis.categories.map(cat=>`<div class="cat-row"><span class="cat-name">${cat.name}</span><div class="cat-bar-wrap"><div class="cat-bar" style="width:${cat.pct}%"></div></div><span class="cat-pct">${cat.pct}%</span></div><div class="cat-desc">${cat.desc}</div>`).join("");
    const trends=analysis.trends.map((t,i)=>`<div class="trend"><div class="trend-title">動向${i+1}: ${t.title}</div><div class="trend-body">${t.body}</div></div>`).join("");
    const html=`<h1>📄 AI論文動向分析レポート</h1><div class="meta"><strong>${analysis.filterDesc}</strong> ／ 対象論文: ${analysis.totalCount}件 ／ 分析日: ${new Date().toLocaleString("ja-JP")}</div>`
      +`<h2>研究テーマ分類</h2><div class="section">${cats}</div>`
      +`<h2>主要研究トレンド</h2><div class="section">${trends}</div>`
      +`<h2>2040年 社会実装シナリオ</h2><div class="section"><p class="body-text">${analysis.impact2050||""}</p></div>`
      +`<h2>産業への戦略的示唆</h2><div class="section"><p class="body-text">${analysis.strategic||""}</p></div>`
      +(analysis.topPatent?`<h2>★ 最注目論文</h2><div class="section highlight"><p class="body-text">${analysis.topPatent}</p></div>`:"");
    const win=window.open("","_blank");
    win.document.write(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"/><title>論文分析レポート</title><style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:"Hiragino Sans","Yu Gothic","Meiryo",sans-serif;font-size:11pt;color:#111;background:#fff;padding:20mm 15mm;}h1{font-size:16pt;color:#0a2540;border-bottom:2px solid #0a2540;padding-bottom:6px;margin-bottom:12px;}h2{font-size:13pt;color:#1a4a7a;margin:16px 0 8px;border-left:4px solid #1a4a7a;padding-left:8px;}.meta{font-size:9.5pt;color:#555;margin-bottom:16px;}.section{margin-bottom:18px;padding:12px 14px;border:1px solid #dde;border-radius:6px;page-break-inside:avoid;}.body-text{font-size:10.5pt;line-height:1.75;color:#222;}.cat-row{display:flex;align-items:center;gap:12px;margin-bottom:7px;}.cat-name{font-size:10.5pt;font-weight:600;min-width:160px;}.cat-bar-wrap{flex:1;height:8px;background:#eef;border-radius:4px;overflow:hidden;}.cat-bar{height:100%;background:#2563eb;border-radius:4px;}.cat-pct{font-size:10pt;font-weight:700;color:#2563eb;min-width:40px;text-align:right;}.cat-desc{font-size:9.5pt;color:#555;margin-left:4px;}.trend{padding:8px 10px 8px 14px;border-left:3px solid #f59e0b;margin-bottom:8px;background:#fffbf0;border-radius:0 4px 4px 0;}.trend-title{font-size:10.5pt;font-weight:600;margin-bottom:3px;}.trend-body{font-size:10pt;color:#333;line-height:1.7;}.highlight{background:#f0f7ff;border:1px solid #bcd;padding:10px 14px;border-radius:5px;}.footer{margin-top:24px;padding-top:10px;border-top:1px solid #ccc;font-size:8.5pt;color:#888;}@media print{body{padding:0;}.section{page-break-inside:avoid;}@page{margin:15mm 12mm;size:A4;}}</style></head><body>${html}<div class="footer">出力日時: ${new Date().toLocaleString("ja-JP")} — Patent Intelligence Platform (論文分析)</div></body></html>`);
    win.document.close();setTimeout(()=>win.print(),400);
  };

  const totalPages=Math.ceil(totalCount/PAGE_SIZE);

  return (
    <div style={{display:"flex",flex:1,overflow:"hidden"}}>
      {/* ===== 左フィルターパネル(幅220: 特許統一) ===== */}
      <div style={{width:220,borderRight:"1px solid "+c.border,background:c.bg1,overflowY:"auto",padding:12,flexShrink:0}}>
        <div style={{fontSize:11,fontWeight:700,color:c.muted,marginBottom:10,letterSpacing:".06em"}}>論文検索・フィルター</div>
        <div style={{marginBottom:12}}>
          <div style={{fontSize:11,color:c.muted,marginBottom:4}}>キーワード</div>
          <input value={keyword} onChange={e=>setKeyword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doSearch(0)}
            placeholder="タイトル・要約（英語）"
            style={{width:"100%",padding:"7px 10px",borderRadius:7,border:"1px solid "+c.border,background:c.bg2,color:c.text,fontSize:12,outline:"none",boxSizing:"border-box"}}/>
          <div style={{fontSize:9,color:c.muted,marginTop:4,lineHeight:1.8}}>
            <span style={{color:c.cyan}}>AND:</span> neural network　<span style={{color:c.green}}>OR:</span> battery OR lithium　<span style={{color:"#f87171"}}>NOT:</span> AI NOT image
          </div>
        </div>
        <div style={{marginBottom:12}}>
          <div style={{fontSize:11,color:c.muted,marginBottom:4}}>企業</div>
          <select value={companySlug} onChange={e=>setCompanySlug(e.target.value)}
            style={{width:"100%",padding:"7px 8px",borderRadius:7,border:"1px solid "+c.border,background:c.bg2,color:c.text,fontSize:12,cursor:"pointer",boxSizing:"border-box"}}>
            <option value="">すべて</option>
            {Object.entries(GROUP_LABELS).map(([gid,label])=>(<optgroup key={gid} label={label}>
              {(companies||[]).filter(co=>co.group_id===gid).map(co=><option key={co.id} value={co.id}>{co.name}</option>)}
            </optgroup>))}
          </select>
        </div>
        <div style={{marginBottom:12}}>
          <div style={{fontSize:11,color:c.muted,marginBottom:4}}>発行年</div>
          <select value={yearFilter} onChange={e=>setYearFilter(e.target.value)}
            style={{width:"100%",padding:"7px 8px",borderRadius:7,border:"1px solid "+c.border,background:c.bg2,color:c.text,fontSize:12,cursor:"pointer",boxSizing:"border-box"}}>
            <option value="">すべて</option>{[2026,2025,2024,2023,2022].map(y=><option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div style={{marginBottom:14}}>
          <div style={{fontSize:11,color:c.muted,marginBottom:4}}>並び順</div>
          <select value={sortBy} onChange={e=>setSortBy(e.target.value)}
            style={{width:"100%",padding:"7px 8px",borderRadius:7,border:"1px solid "+c.border,background:c.bg2,color:c.text,fontSize:12,cursor:"pointer",boxSizing:"border-box"}}>
            <option value="cited_by_count">被引用数</option><option value="year">新着</option>
          </select>
        </div>
        <button onClick={()=>doSearch(0)} style={{width:"100%",padding:"8px 0",borderRadius:7,border:"none",background:c.cyan,color:"#000",fontWeight:700,fontSize:13,cursor:"pointer",marginBottom:6}}>
          {loading?"検索中...":"🔍 検索"}</button>
        <button onClick={()=>{setKeyword("");setCompanySlug("");setYearFilter("");}}
          style={{width:"100%",padding:"5px 0",borderRadius:7,border:"1px solid "+c.border,background:"transparent",color:c.muted,fontSize:11,cursor:"pointer",marginBottom:12}}>リセット</button>
        <div style={{borderTop:"1px solid "+c.border,paddingTop:10}}>
          <div style={{fontSize:12,fontWeight:700,color:c.cyan,marginBottom:8}}>{totalCount.toLocaleString()} 件</div>
          {results.length>0 && <button onClick={downloadCSV} style={{width:"100%",padding:"6px 0",borderRadius:7,border:"1px solid #16a34a",background:"transparent",color:"#16a34a",fontSize:11,fontWeight:600,cursor:"pointer",marginBottom:8}}>📥 CSV保存</button>}
          {totalCount>0 && <button onClick={doAnalyzeResults} disabled={analyzePhase==="analyzing"}
            style={{width:"100%",padding:"8px 0",borderRadius:7,border:"none",background:analyzePhase==="analyzing"?c.bg3:c.amber,color:analyzePhase==="analyzing"?c.muted:"#000",fontWeight:700,fontSize:12,cursor:"pointer"}}>
            {analyzePhase==="analyzing"?"🤖 分析中...":"🤖 AI分析"}</button>}
        </div>
      </div>

      {/* ===== 右: 結果 ===== */}
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

        {/* AI分析結果(特許準拠レイアウト) */}
        {analysis && analysis.categories && analyzePhase==="done" && showAnalysis && (
          <div style={{background:c.bg1,borderRadius:10,border:"1px solid "+c.amber,marginBottom:16,overflow:"hidden"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 14px",background:"#1a1200",borderBottom:"1px solid "+c.border,flexWrap:"wrap"}}>
              <span style={{fontSize:12,fontWeight:700,color:c.amber}}>🤖 AI研究動向分析</span>
              <span style={{fontSize:11,color:c.cyan,padding:"1px 7px",borderRadius:4,background:"#0c2d42",border:"1px solid "+c.border}}>{analysis.totalCount}件</span>
              <span style={{fontSize:11,color:c.muted}}>{analysis.filterDesc}</span>
              <span style={{fontSize:10,color:c.green}}>✅ DB保存済み</span>
              <button onClick={printPDF} style={{padding:"3px 10px",borderRadius:5,border:"1px solid #16a34a",background:"transparent",color:"#16a34a",fontSize:11,fontWeight:600,cursor:"pointer"}}>📄 PDF出力</button>
              <button onClick={()=>setShowAnalysis(false)} style={{marginLeft:"auto",fontSize:11,color:c.muted,background:"transparent",border:"none",cursor:"pointer"}}>▲ 閉じる</button>
            </div>
            <div style={{padding:14,display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div>
                <div style={{fontSize:11,fontWeight:700,color:c.cyan,marginBottom:8}}>研究テーマ分類</div>
                {analysis.categories.map((cat,i)=>(<div key={i} style={{marginBottom:8}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:11,color:c.text}}>{cat.name}</span><span style={{fontSize:11,color:c.cyan,fontWeight:700}}>{cat.pct}%</span></div>
                  <div style={{height:5,background:c.bg2,borderRadius:3,overflow:"hidden",marginBottom:2}}><div style={{height:"100%",width:cat.pct+"%",background:"linear-gradient(90deg,"+c.cyan+",#7dd3fc)",borderRadius:3}}/></div>
                  <div style={{fontSize:10,color:c.muted}}>{cat.desc}</div>
                </div>))}
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <div>
                  <div style={{fontSize:11,fontWeight:700,color:c.amber,marginBottom:6}}>主要研究トレンド</div>
                  {analysis.trends.map((t,i)=>(<div key={i} style={{marginBottom:8,paddingLeft:8,borderLeft:"2px solid "+c.amber}}>
                    <div style={{fontSize:11,fontWeight:600,color:c.text,marginBottom:2}}>{t.title}</div>
                    <div style={{fontSize:10,color:c.muted,lineHeight:1.6}}>{t.body}</div>
                  </div>))}
                </div>
                <div style={{padding:"8px 10px",background:c.bg2,borderRadius:6}}>
                  <div style={{fontSize:10,fontWeight:700,color:c.green,marginBottom:4}}>2040年 社会実装シナリオ</div>
                  <div style={{fontSize:11,color:c.text,lineHeight:1.65}}>{analysis.impact2050}</div>
                </div>
                <div style={{padding:"8px 10px",background:c.bg2,borderRadius:6}}>
                  <div style={{fontSize:10,fontWeight:700,color:c.purple,marginBottom:4}}>産業への戦略的示唆</div>
                  <div style={{fontSize:11,color:c.text,lineHeight:1.65}}>{analysis.strategic}</div>
                </div>
                {analysis.topPatent && (<div style={{padding:"8px 10px",background:c.bg2,borderRadius:6,border:"1px solid "+c.cyan}}>
                  <div style={{fontSize:10,color:c.cyan,marginBottom:3}}>★ 最注目論文</div>
                  <div style={{fontSize:11,color:c.text,lineHeight:1.5}}>{analysis.topPatent}</div>
                </div>)}
              </div>
            </div>
          </div>
        )}
        {analysis && analysis.categories && !showAnalysis && (
          <button onClick={()=>setShowAnalysis(true)} style={{width:"100%",padding:"6px",borderRadius:6,border:"1px solid "+c.amber,background:"transparent",color:c.amber,fontSize:11,cursor:"pointer",marginBottom:12}}>▼ AI分析結果を表示する</button>
        )}

        <div style={{fontSize:11,color:c.muted,marginBottom:12}}>{loading?"検索中...":totalCount.toLocaleString()+"件 / "+totalPages+"ページ中 "+(page+1)+"ページ"}</div>

        {results.length===0&&!loading&&<div style={{padding:60,textAlign:"center",color:c.muted,fontSize:14}}>検索条件に一致する論文がありません</div>}

        {results.map((r,idx)=>{
          const topics=parseTopics(r.topics);
          const isOpen=openId===r.openalex_id;
          const hasTitleJa=!!r.title_ja; const hasAbsJa=!!r.abstract_ja;
          // 展開中のAI結果
          const curAi=(isOpen&&aiPhase==="done"&&aiResult)?aiResult:null;
          const titleJa=curAi?.titleJa||r.title_ja;
          const abstractJa=curAi?.abstractJa||r.abstract_ja;
          return (
            <div key={r.openalex_id+"_"+idx} style={{...card,marginBottom:10,border:"1px solid "+(isOpen?c.purple:c.border)}}>
              <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                <span style={{fontSize:10,fontWeight:700,color:c.green,padding:"1px 6px",borderRadius:3,border:"1px solid "+c.green,background:c.bg0,flexShrink:0,marginTop:2}}>{r.publication_year}</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,color:"#e2e8f0",lineHeight:1.4,marginBottom:3,cursor:"pointer"}} onClick={()=>{setOpenId(isOpen?null:r.openalex_id);setAiPhase("idle");setAiResult(null);}}>
                    {r.title||"(タイトルなし)"}</div>
                  {titleJa && <div style={{fontSize:13,fontWeight:600,color:c.purple,marginBottom:5}}>{titleJa}</div>}
                  <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:6}}>
                    <span style={{fontSize:11,color:c.cyan,padding:"1px 6px",borderRadius:4,background:"#0c2d42",border:"1px solid "+c.border}}>{coName(r.company_slug)}</span>
                    <span style={{fontSize:11,color:c.muted,fontFamily:"monospace"}}>被引用 {(r.cited_by_count||0).toLocaleString()}</span>
                    {r.is_oa&&<span style={{fontSize:9,color:"#4ade80",padding:"1px 6px",borderRadius:3,border:"1px solid #4ade80"}}>OA</span>}
                    {r.source_name&&<span style={{fontSize:10,color:c.muted,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.source_name}</span>}
                  </div>
                  {/* DB保存済みバッジ */}
                  <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:6}}>
                    {hasTitleJa&&<span style={{fontSize:9,color:"#e879f9",padding:"1px 6px",borderRadius:3,border:"1px solid #e879f9",opacity:.8}}>AI解説</span>}
                  </div>
                  {topics.length>0&&<div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:6}}>
                    {topics.slice(0,3).map((t,i)=><span key={i} style={{fontSize:9,padding:"1px 6px",borderRadius:3,border:"1px solid "+c.border,color:c.muted}}>{t.display_name}</span>)}
                  </div>}

                  {/* DB保存済みの日本語要約(閉じていても表示) */}
                  {hasAbsJa && !isOpen && (
                    <div style={{fontSize:12,color:c.text,lineHeight:1.8,padding:"6px 10px",background:c.bg2,borderRadius:6,borderLeft:"3px solid #e879f9",marginBottom:6}}>
                      <div style={{fontSize:10,color:"#e879f9",fontWeight:600,marginBottom:3}}>AI解説</div>
                      {r.abstract_ja.slice(0,200)}{r.abstract_ja.length>200&&"..."}
                    </div>
                  )}

                  {isOpen&&(<>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
                      {r.oa_url&&<a href={r.oa_url} target="_blank" rel="noreferrer" style={{fontSize:11,padding:"3px 10px",borderRadius:5,background:"#059669",color:"#fff",textDecoration:"none",fontWeight:600}}>📖 全文を読む</a>}
                      {r.doi&&<a href={`https://doi.org/${r.doi}`} target="_blank" rel="noreferrer" style={{fontSize:11,padding:"3px 10px",borderRadius:5,border:"1px solid "+c.border,background:c.bg2,color:c.cyan,textDecoration:"none"}}>🔗 DOI</a>}
                      <a href={`https://openalex.org/${r.openalex_id}`} target="_blank" rel="noreferrer" style={{fontSize:11,padding:"3px 10px",borderRadius:5,border:"1px solid "+c.border,background:c.bg2,color:c.muted,textDecoration:"none"}}>OpenAlex</a>
                      <button onClick={()=>doAiExplain(r)} disabled={aiPhase==="loading"}
                        style={{fontSize:11,padding:"3px 10px",borderRadius:5,border:"none",background:aiPhase==="loading"?c.bg3:"#e879f9",color:aiPhase==="loading"?c.muted:"#000",fontWeight:600,cursor:"pointer"}}>
                        {aiPhase==="loading"?"⏳ 翻訳中...":(hasTitleJa?"🔄 再翻訳":"✨ AI解説(日本語訳)")}</button>
                    </div>
                    {r.abstract_text&&(<div style={{fontSize:11,color:c.muted,lineHeight:1.7,padding:"6px 10px",background:"#0a1e0a",borderRadius:5,borderLeft:"3px solid "+c.amber,marginBottom:8}}>
                      <div style={{fontSize:10,color:c.amber,fontWeight:600,marginBottom:3}}>Abstract (原文)</div>{r.abstract_text}</div>)}
                    {abstractJa&&(<div style={{fontSize:12,color:c.text,lineHeight:1.8,padding:"8px 12px",background:c.bg2,borderRadius:6,borderLeft:"3px solid #e879f9",marginBottom:8}}>
                      <div style={{fontSize:10,color:"#e879f9",fontWeight:600,marginBottom:3}}>AI解説（日本語訳）</div>{abstractJa}</div>)}
                  </>)}
                  <button onClick={()=>{setOpenId(isOpen?null:r.openalex_id);setAiPhase("idle");setAiResult(null);}}
                    style={{fontSize:11,padding:"3px 10px",borderRadius:5,border:"1px solid "+(isOpen?c.purple:c.border),background:isOpen?"#0d0820":"transparent",color:isOpen?c.purple:c.muted,cursor:"pointer",marginTop:4}}>
                    {isOpen?"▼ 閉じる":"▶ 詳細を表示"}</button>
                </div>
              </div>
            </div>
          );
        })}

        {totalPages>1&&(<div style={{display:"flex",justifyContent:"center",gap:8,marginTop:16}}>
          <button onClick={()=>doSearch(page-1)} disabled={page===0} style={{padding:"6px 14px",borderRadius:6,border:"1px solid "+c.border,background:"transparent",color:page===0?c.muted:c.text,cursor:page===0?"not-allowed":"pointer"}}>← 前</button>
          <span style={{padding:"6px 14px",fontSize:12,color:c.muted}}>{page+1} / {totalPages}</span>
          <button onClick={()=>doSearch(page+1)} disabled={page>=totalPages-1} style={{padding:"6px 14px",borderRadius:6,border:"1px solid "+c.border,background:"transparent",color:page>=totalPages-1?c.muted:c.text,cursor:page>=totalPages-1?"not-allowed":"pointer"}}>次 →</button>
        </div>)}
      </div>
    </div>
  );
}

/* ━━━ 論文分析結果 → HTML断片（PDF出力用、printPDFと一括PDFで共有） ━━━━━━━ */
/* PaperExplorer.jsx と Dashboard.jsx の両方から使うため、コンポーネントを含まない
   この専用ファイルに切り出している（react-refresh/only-export-components 対策） */
export function generatePaperAnalysisHTML(filterLabel, analysis) {
  const cats = (analysis.categories||[]).map(cat=>`<div class="cat-row"><span class="cat-name">${cat.name}</span><div class="cat-bar-wrap"><div class="cat-bar" style="width:${cat.pct}%"></div></div><span class="cat-pct">${cat.pct}%</span></div><div class="cat-desc">${cat.desc}</div>`).join("");
  const trends = (analysis.trends||[]).map((t,i)=>`<div class="trend"><div class="trend-title">動向${i+1}: ${t.title}</div><div class="trend-body">${t.body}</div></div>`).join("");
  return `<h1>📄 AI論文動向分析レポート — ${filterLabel}</h1><div class="meta"><strong>${analysis.filterDesc||filterLabel}</strong> ／ 対象論文: ${analysis.totalCount}件 ／ 分析日: ${new Date().toLocaleString("ja-JP")}</div>`
    +`<h2>研究テーマ分類</h2><div class="section">${cats}</div>`
    +`<h2>主要研究トレンド</h2><div class="section">${trends}</div>`
    +`<h2>2040年 社会実装シナリオ</h2><div class="section"><p class="body-text">${analysis.impact2050||""}</p></div>`
    +`<h2>産業への戦略的示唆</h2><div class="section"><p class="body-text">${analysis.strategic||""}</p></div>`
    +(analysis.topPatent?`<h2>★ 最注目論文</h2><div class="section highlight"><p class="body-text">${analysis.topPatent}</p></div>`:"");
}

export function printPaperHTML(title, bodyHtml) {
  const win = window.open("", "_blank");
  win.document.write(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"/><title>${title}</title><style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:"Hiragino Sans","Yu Gothic","Meiryo",sans-serif;font-size:11pt;color:#111;background:#fff;padding:20mm 15mm;}h1{font-size:16pt;color:#0a2540;border-bottom:2px solid #0a2540;padding-bottom:6px;margin-bottom:12px;}h2{font-size:13pt;color:#1a4a7a;margin:16px 0 8px;border-left:4px solid #1a4a7a;padding-left:8px;}.meta{font-size:9.5pt;color:#555;margin-bottom:16px;}.section{margin-bottom:18px;padding:12px 14px;border:1px solid #dde;border-radius:6px;page-break-inside:avoid;}.body-text{font-size:10.5pt;line-height:1.75;color:#222;}.cat-row{display:flex;align-items:center;gap:12px;margin-bottom:7px;}.cat-name{font-size:10.5pt;font-weight:600;min-width:160px;}.cat-bar-wrap{flex:1;height:8px;background:#eef;border-radius:4px;overflow:hidden;}.cat-bar{height:100%;background:#2563eb;border-radius:4px;}.cat-pct{font-size:10pt;font-weight:700;color:#2563eb;min-width:40px;text-align:right;}.cat-desc{font-size:9.5pt;color:#555;margin-left:4px;}.trend{padding:8px 10px 8px 14px;border-left:3px solid #f59e0b;margin-bottom:8px;background:#fffbf0;border-radius:0 4px 4px 0;}.trend-title{font-size:10.5pt;font-weight:600;margin-bottom:3px;}.trend-body{font-size:10pt;color:#333;line-height:1.7;}.highlight{background:#f0f7ff;border:1px solid #bcd;padding:10px 14px;border-radius:5px;}.footer{margin-top:24px;padding-top:10px;border-top:1px solid #ccc;font-size:8.5pt;color:#888;}@media print{body{padding:0;}.section{page-break-inside:avoid;}@page{margin:15mm 12mm;size:A4;}}</style></head><body>${bodyHtml}<div class="footer">出力日時: ${new Date().toLocaleString("ja-JP")} — Patent Intelligence Platform (論文分析)</div></body></html>`);
  win.document.close(); setTimeout(()=>win.print(), 400);
}

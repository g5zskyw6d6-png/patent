/**
 * Vercel Function: Extract Keywords from Papers
 * Claude API を使用してキーワードを抽出
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { papers, companySlug } = req.body;

    if (!papers || !Array.isArray(papers) || papers.length === 0) {
      return res.status(400).json({ error: 'papers array is required' });
    }

    const claudeApiKey = process.env.CLAUDE_API_KEY;
    if (!claudeApiKey) {
      return res.status(500).json({ error: 'Claude API key not configured' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ error: 'Supabase credentials not configured' });
    }

    const keywords = {};

    // 各論文からキーワードを抽出
    for (const paper of papers) {
      try {
        const prompt = `以下の学術論文のタイトルと要約から、主要キーワード（技術用語、概念、手法など）を最大10個抽出してください。\n\n【タイトル】\n${paper.title}\n\n【要約】\n${paper.abstract_text || '(要約なし)'}\n\n形式: キーワード1, キーワード2, キーワード3, ... (カンマ区切り)`;

        const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': claudeApiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 500,
            messages: [{ role: 'user', content: prompt }],
          }),
        });

        if (!claudeRes.ok) {
          console.warn(`Claude API error for paper ${paper.openalex_id}: ${claudeRes.status}`);
          continue;
        }

        const claudeData = await claudeRes.json();
        const extractedText = claudeData.content?.[0]?.text || '';
        const extractedKeywords = extractedText
          .split(',')
          .map(k => k.trim().toLowerCase())
          .filter(k => k && k.length > 1);

        // キーワード集計
        for (const kw of extractedKeywords) {
          keywords[kw] = (keywords[kw] || 0) + 1;
        }
      } catch (error) {
        console.warn(`Failed to extract keywords from ${paper.openalex_id}:`, error.message);
      }
    }

    // キーワードをカウント順でソート
    const sortedKeywords = Object.entries(keywords)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 50) // Top 50
      .map(([keyword, count]) => ({ keyword, count }));

    return res.status(200).json({ keywords: sortedKeywords });
  } catch (error) {
    console.error('Keywords extraction error:', error);
    return res.status(500).json({ error: error.message });
  }
}

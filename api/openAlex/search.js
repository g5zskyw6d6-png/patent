/**
 * Vercel Function: OpenAlex API Proxy
 * CORS を回避し、キーワード検索を実行
 */

export default async function handler(req, res) {
  // CORS ヘッダー設定
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { keyword, companySlug, yearFilter, sortBy, limit = 20, offset = 0 } = req.body;

    if (!keyword || keyword.trim() === '') {
      return res.status(400).json({ error: 'keyword is required' });
    }

    // キーワードフィルター構築（AND/OR/NOT パーサー）
    const buildFilter = (raw) => {
      if (!raw.trim()) return '';
      const parts = raw.trim().split(/\s+/);
      const andT = [], orT = [], notT = [];
      let mode = 'and';

      for (const p of parts) {
        if (p.toUpperCase() === 'AND') {
          mode = 'and';
          continue;
        }
        if (p.toUpperCase() === 'OR') {
          mode = 'or';
          continue;
        }
        if (p.toUpperCase() === 'NOT') {
          mode = 'not';
          continue;
        }
        if (mode === 'or') orT.push(p);
        else if (mode === 'not') notT.push(p);
        else andT.push(p);
        mode = 'and';
      }

      const f = [];
      for (const t of andT) f.push(`or=(title.ilike.*${t}*,abstract_text.ilike.*${t}*)`);
      if (orT.length > 0) f.push(`or=(${orT.map(t => `title.ilike.*${t}*,abstract_text.ilike.*${t}*`).join(',')})`);
      for (const t of notT) {
        f.push(`title=not.ilike.*${t}*`);
        f.push(`abstract_text=not.ilike.*${t}*`);
      }
      return f.join('&');
    };

    const filterStr = buildFilter(keyword);
    let queryParts = [
      'select=openalex_id,doi,title,title_ja,publication_year,cited_by_count,is_oa,oa_url,source_name,type,company_slug,abstract_text,abstract_ja,topics',
    ];

    if (filterStr) queryParts.push(filterStr);
    if (companySlug) queryParts.push(`company_slug=eq.${companySlug}`);
    if (yearFilter) queryParts.push(`publication_year=eq.${yearFilter}`);

    const orderStr = sortBy === 'year'
      ? 'publication_year.desc,cited_by_count.desc'
      : 'cited_by_count.desc,publication_year.desc';

    queryParts.push(`order=${orderStr}`);
    queryParts.push(`limit=${Math.min(limit, 100)}`);
    queryParts.push(`offset=${offset}`);

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ error: 'Supabase credentials not configured' });
    }

    const query = queryParts.join('&');
    const fetchUrl = `${supabaseUrl}/rest/v1/papers_search?${query}`;

    const response = await fetch(fetchUrl, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Accept-Profile': 'openalex',
        'Prefer': 'count=estimated',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Supabase papers_search failed:', response.status, errorText);
      return res.status(response.status).json({ error: `Search failed: ${response.status}` });
    }

    const data = await response.json();
    const contentRange = response.headers.get('content-range');
    let totalCount = 0;

    if (contentRange) {
      const match = contentRange.match(/\/(\d+)/);
      if (match) totalCount = parseInt(match[1]);
    }

    return res.status(200).json({
      results: Array.isArray(data) ? data : [],
      totalCount,
    });
  } catch (error) {
    console.error('OpenAlex proxy error:', error);
    return res.status(500).json({ error: error.message });
  }
}

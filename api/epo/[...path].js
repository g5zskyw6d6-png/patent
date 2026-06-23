export default async function handler(req, res) {
  try {
    // URLからパスを直接取得（クエリパラメータを除く）
    const fullUrl = req.url || '';
    const basePath = fullUrl.replace(/^\/api\/epo\//, '').split('?')[0];

    const queryParams = { ...req.query };
    delete queryParams.path;
    const queryStr = Object.keys(queryParams).length > 0
      ? '?' + Object.entries(queryParams)
          .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(String(v)))
          .join('&')
      : '';

    const url = 'https://ops.epo.org/3.2/rest-services/' + basePath + queryStr;
    console.log('EPO URL:', url);

    const response = await fetch(url, {
      method: req.method,
      headers: {
        'Authorization': req.headers['authorization'] || '',
        'Accept': req.headers['accept'] || 'application/xml',
      },
    });

    const data = await response.text();
    const contentType = response.headers.get('content-type') || 'text/xml';
    res.status(response.status).setHeader('Content-Type', contentType).send(data);
  } catch(e) {
    console.error('EPO proxy error:', e.message);
    res.status(500).json({ error: e.message });
  }
}

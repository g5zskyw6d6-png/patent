export default async function handler(req, res) {
  try {
    const rawPath = req.query.path || '';
    const pathStr = Array.isArray(rawPath) ? rawPath.join('/') : rawPath;

    const queryParams = {};
    Object.keys(req.query).forEach(k => {
      if (k !== 'path') queryParams[k] = req.query[k];
    });
    const queryStr = Object.keys(queryParams).length > 0
      ? '?' + Object.entries(queryParams)
          .map(([k,v]) => encodeURIComponent(k)+'='+encodeURIComponent(String(v)))
          .join('&')
      : '';

    const url = 'https://ops.epo.org/3.2/rest-services/' + pathStr + queryStr;
    console.log('EPO proxy URL:', url);

    const response = await fetch(url, {
      method: req.method,
      headers: {
        'Authorization': req.headers['authorization'] || '',
        'Accept': req.headers['accept'] || 'application/xml',
      },
    });

    const data = await response.text();
    res.status(response.status)
       .setHeader('Content-Type', response.headers.get('content-type') || 'text/xml')
       .send(data);
  } catch(e) {
    console.error('EPO proxy error:', e.message);
    res.status(500).json({ error: e.message });
  }
}

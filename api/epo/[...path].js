export default async function handler(req, res) {
  try {
    const pathParts = Array.isArray(req.query.path) 
      ? req.query.path 
      : [req.query.path].filter(Boolean);
    const path = pathParts.join('/');

    const queryParams = { ...req.query };
    delete queryParams.path;
    const queryStr = Object.keys(queryParams).length > 0
      ? '?' + Object.entries(queryParams)
          .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(String(v)))
          .join('&')
      : '';

    const url = 'https://ops.epo.org/3.2/rest-services/' + path + queryStr;

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
    res.status(500).json({ error: e.message });
  }
}

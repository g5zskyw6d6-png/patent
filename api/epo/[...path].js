export default async function handler(req, res) {
  const path = req.query.path?.join('/') || '';
  const query = new URLSearchParams(req.query);
  query.delete('path');
  const queryStr = query.toString() ? '?' + query.toString() : '';
  const url = `https://ops.epo.org/3.2/rest-services/${path}${queryStr}`;
  const response = await fetch(url, {
    method: req.method,
    headers: {
      'Authorization': req.headers['authorization'],
      'Accept': req.headers['accept'] || 'application/xml',
    },
  });
  const data = await response.text();
  res.status(response.status)
     .setHeader('Content-Type', response.headers.get('content-type') || 'text/xml')
     .send(data);
}

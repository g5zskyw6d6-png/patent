export default async function handler(req, res) {
  try {
    const response = await fetch('https://ops.epo.org/3.2/auth/accesstoken', {
      method: 'POST',
      headers: {
        'Authorization': req.headers['authorization'] || '',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const data = await response.text();
    res.status(response.status)
       .setHeader('Content-Type', response.headers.get('content-type') || 'application/json')
       .send(data);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}

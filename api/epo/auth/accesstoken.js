export default async function handler(req, res) {
  const response = await fetch('https://ops.epo.org/3.2/auth/accesstoken', {
    method: 'POST',
    headers: {
      'Authorization': req.headers['authorization'],
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: req.body,
  });
  const data = await response.text();
  res.status(response.status).send(data);
}

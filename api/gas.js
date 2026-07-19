function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function setNoCache(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
}

function appendQueryParams(url, query) {
  const targetUrl = new URL(url);

  Object.entries(query || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => targetUrl.searchParams.append(key, item));
      return;
    }
    if (value !== undefined) {
      targetUrl.searchParams.append(key, value);
    }
  });

  return targetUrl.toString();
}

module.exports = async (req, res) => {
  setCors(res);
  setNoCache(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const gasUrl = process.env.GAS_API_URL;
  if (!gasUrl) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(500).send(
      JSON.stringify({
        error: 'GAS_API_URL is not set in Vercel Environment Variables',
      })
    );
    return;
  }

  const targetUrl = appendQueryParams(gasUrl, req.query);

  try {
    const fetchOptions = { method: req.method };
    const forwardHeaders = {};

    if (req.method === 'POST') {
      const incomingContentType = req.headers['content-type'];
      if (incomingContentType) {
        forwardHeaders['Content-Type'] = incomingContentType;
      }

      if (Buffer.isBuffer(req.body) || typeof req.body === 'string') {
        fetchOptions.body = req.body;
      } else if (req.body !== undefined) {
        fetchOptions.body = JSON.stringify(req.body);
        if (!incomingContentType) {
          forwardHeaders['Content-Type'] = 'application/json; charset=utf-8';
        }
      }
    }

    if (Object.keys(forwardHeaders).length) {
      fetchOptions.headers = forwardHeaders;
    }

    const gasResponse = await fetch(targetUrl, fetchOptions);
    const responseBody = await gasResponse.text();

    const contentType = gasResponse.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }

    res.status(gasResponse.status).send(responseBody);
  } catch (err) {
    res.status(502).send('Bad Gateway');
  }
};

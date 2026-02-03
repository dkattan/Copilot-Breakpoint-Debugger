const http = require('node:http');

let swaggerHits = 0;

const server = http.createServer((req, res) => {
  if (req.url && req.url.startsWith('/swagger')) {
    swaggerHits += 1; // SWAGGER_HANDLER_BREAKPOINT
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, swaggerHits }));
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(0, () => {
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  console.log(`listening on http://localhost:${port}`);
});

setTimeout(() => {
  server.close();
}, 5000);

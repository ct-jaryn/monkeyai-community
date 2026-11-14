// Thin Worker in front of the static assets for monkeyai.online.
// Reproduces the Nginx vhost (deploy/nginx monkeyai.online.conf) so the
// cutover is behaviour-neutral:
// - http:// and www. -> https://monkeyai.online (301, path + query kept)
// - /foo -> /foo/ as a permanent 301 (assets layer answers 307)
// - 404 page with status 404 and Cache-Control: no-store (also for /404.html)
// - dotfiles (/.git, /.env ...) -> 403
// - Cache-Control map: images/fonts public 1 day, everything else no-cache
// - *.workers.dev responses carry X-Robots-Tag: noindex
// - /.well-known/acme-challenge/* is passed through to the origin (certificate renewals)
const APEX = 'monkeyai.online';
const LONG = /\.(?:png|svg|ttf|woff2?)$/i;
// Live zone serves these through Cloudflare's Browser Cache TTL (4 h) on top of Nginx's no-cache.
const EDGE_TTL = /\.(?:css|js|txt)$/i;
// Nginx answers text types with an explicit UTF-8 charset.
const CHARSET = { 'text/html': 'text/html; charset=utf-8', 'text/plain': 'text/plain; charset=utf-8', 'application/javascript': 'application/javascript; charset=utf-8', 'text/javascript': 'application/javascript; charset=utf-8', 'application/xml': 'text/xml; charset=utf-8', 'text/xml': 'text/xml; charset=utf-8' };

function withHeaders(res, extra) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(extra)) out.headers.set(k, v);
  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const onWorkersDev = url.hostname.endsWith('.workers.dev');
    const base = {
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "frame-ancestors 'none'",
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    };
    if (onWorkersDev) base['X-Robots-Tag'] = 'noindex';

    // Keep Let's Encrypt HTTP-01 renewals on the origin working (rollback safety):
    // on a zone route, fetch() of the same request goes to the origin server.
    if (!onWorkersDev && url.pathname.startsWith('/.well-known/acme-challenge/')) return fetch(request);
    if (!onWorkersDev && (url.protocol === 'http:' || url.hostname !== APEX)) {
      return new Response(null, { status: 301, headers: { ...base, Location: `https://${APEX}${url.pathname}${url.search}`, 'Cache-Control': 'no-cache' } });
    }
    if (/(^|\/)\./.test(url.pathname)) {
      return new Response('<html>\r\n<head><title>403 Forbidden</title></head>\r\n<body>\r\n<center><h1>403 Forbidden</h1></center>\r\n</body>\r\n</html>\r\n', { status: 403, headers: { ...base, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' } });
    }
    if (url.pathname === '/404.html') {
      const page = await env.ASSETS.fetch(new Request(new URL('/__not-found__/', url), request));
      return withHeaders(new Response(page.body, { status: 404, headers: page.headers }), { ...base, 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8' });
    }

    // Nginx serves /dir/index.html directly (200); the assets layer would redirect it.
    let req = request;
    if (url.pathname.endsWith('/index.html')) req = new Request(new URL(url.pathname.slice(0, -10) + url.search, url), request);
    let res = await env.ASSETS.fetch(req);
    if (res.status === 307 || res.status === 308) {
      const loc = res.headers.get('Location');
      res = new Response(null, { status: 301, headers: { Location: loc ? new URL(loc, url).href.replace(/^http:/, 'https:') : '/' } });
    }
    const cc = res.status === 404 ? 'no-store' : LONG.test(url.pathname) ? 'public, max-age=86400' : (res.status === 200 && EDGE_TTL.test(url.pathname)) ? 'max-age=14400' : 'no-cache';
    const extra = { ...base, 'Cache-Control': cc };
    const ct = (res.headers.get('Content-Type') || '').split(';')[0].trim();
    if (CHARSET[ct]) extra['Content-Type'] = CHARSET[ct];
    return withHeaders(res, extra);
  },
};

/**
 * Fly Sky — 열품타 중계 서버 (Cloudflare Worker)
 *
 * 브라우저에서 열품타 서버(pi.tgclab.com)를 바로 부르면 CORS에 막혀서,
 * 이 Worker가 중간에서 요청을 그대로 전달하고 CORS 헤더만 붙여 줘요.
 *
 * - 허용한 사이트(ALLOWED_ORIGINS)에서 온 요청만 받음
 * - Fly Sky가 쓰는 경로만 통과 (아래 ROUTES)
 * - 비밀번호·토큰을 저장하거나 기록하지 않음
 */
const UPSTREAM = 'https://pi.tgclab.com';

const ROUTES = [
  ['POST', '/user/sign-in-jwt'],
  ['POST', '/user/v2/reload/info'],
  ['POST', '/study/start'],
  ['POST', '/study/stop'],
  ['GET', '/group/groups/v2'],
  ['GET', '/logs/group/members/v2'],
];

const DEFAULT_ORIGINS = 'https://samsungkorea.github.io';

export default {
  async fetch(request, env) {
    const allowed = (env.ALLOWED_ORIGINS || DEFAULT_ORIGINS)
      .split(',').map((s) => s.trim()).filter(Boolean);
    const origin = request.headers.get('Origin') || '';
    const originOk = allowed.includes(origin);

    const cors = {
      'Access-Control-Allow-Origin': originOk ? origin : allowed[0] || '',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };
    const json = (status, body) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
      });

    if (!originOk) return json(403, { error: 'origin' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    if (!ROUTES.some(([m, p]) => m === request.method && p === url.pathname)) {
      return json(404, { error: 'route' });
    }

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    const auth = request.headers.get('Authorization');
    if (auth) headers['Authorization'] = auth;

    let upstream;
    try {
      upstream = await fetch(UPSTREAM + url.pathname + url.search, {
        method: request.method,
        headers,
        body: request.method === 'POST' ? await request.text() : undefined,
      });
    } catch (e) {
      return json(502, { error: 'upstream' });
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...cors,
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  },
};

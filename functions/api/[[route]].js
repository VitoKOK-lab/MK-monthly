/* MK 排班 API（Cloudflare Pages Functions，與網頁同網域）
   KV 鍵：
     state                      店長設定（S 的完整 JSON）+ updatedAt
     published                  已發布班表 { "2026-11": {...}, ... }
     hist:published:<月>:<時間>  發布歷史（保留查核用）
   權限：讀公開；寫入要帶 X-PIN，值等於環境變數 ADMIN_PIN（未設則 0000）。 */

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function cors(request, env){
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const h = { 'access-control-allow-methods': 'GET,PUT,POST,OPTIONS', 'access-control-allow-headers': 'content-type,x-pin', 'access-control-max-age': '86400' };
  if (allowed.includes(origin)) h['access-control-allow-origin'] = origin;
  return h;
}
const json = (data, status, extra) => new Response(JSON.stringify(data), { status: status || 200, headers: { ...JSON_HEADERS, ...(extra || {}) } });
const pinOk = (request, env) => (request.headers.get('X-PIN') || '') === String(env.ADMIN_PIN || '0000');

export async function onRequest(context){
  const { request, env, params } = context;
  const route = (params.route || []).join('/');
  const c = cors(request, env);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: c });

  try {
    /* 健康檢查 */
    if (route === 'ping') return json({ ok: true, time: new Date().toISOString() }, 200, c);

    /* PIN 驗證：前端進店長後台時呼叫 */
    if (route === 'auth' && request.method === 'POST'){
      const body = await request.json().catch(() => ({}));
      const ok = String(body.pin || '') === String(env.ADMIN_PIN || '0000');
      return json({ ok }, ok ? 200 : 401, c);
    }

    /* 店長設定 */
    if (route === 'state'){
      if (request.method === 'GET'){
        const raw = await env.MK.get('state');
        return json(raw ? JSON.parse(raw) : null, 200, c);
      }
      if (request.method === 'PUT'){
        if (!pinOk(request, env)) return json({ error: 'PIN 錯誤' }, 401, c);
        const body = await request.json();
        if (!body || typeof body !== 'object' || !body.s || !Array.isArray(body.s.staff)) return json({ error: '格式不對' }, 400, c);
        body.updatedAt = new Date().toISOString();
        await env.MK.put('state', JSON.stringify(body));
        return json({ ok: true, updatedAt: body.updatedAt }, 200, c);
      }
    }

    /* 已發布班表（全部月份） */
    if (route === 'published' && request.method === 'GET'){
      const raw = await env.MK.get('published');
      return json(raw ? JSON.parse(raw) : {}, 200, c);
    }
    /* 發布某一月 */
    const m = /^published\/(\d{4}-\d{2})$/.exec(route);
    if (m){
      const month = m[1];
      if (request.method === 'GET'){
        const raw = await env.MK.get('published');
        const all = raw ? JSON.parse(raw) : {};
        return json(all[month] || null, 200, c);
      }
      if (request.method === 'PUT'){
        if (!pinOk(request, env)) return json({ error: 'PIN 錯誤' }, 401, c);
        const rec = await request.json();
        if (!rec || !Array.isArray(rec.grid) || !Array.isArray(rec.staff)) return json({ error: '格式不對' }, 400, c);
        const raw = await env.MK.get('published');
        const all = raw ? JSON.parse(raw) : {};
        rec.savedAt = rec.savedAt || new Date().toISOString().slice(0,16).replace('T',' ');
        all[month] = rec;
        await env.MK.put('published', JSON.stringify(all));
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        await env.MK.put(`hist:published:${month}:${stamp}`, JSON.stringify(rec), { expirationTtl: 60*60*24*365 });
        return json({ ok: true, month, savedAt: rec.savedAt }, 200, c);
      }
    }
    /* 發布歷史（查核用） */
    const h = /^published\/(\d{4}-\d{2})\/history$/.exec(route);
    if (h && request.method === 'GET'){
      const list = await env.MK.list({ prefix: `hist:published:${h[1]}:` });
      return json(list.keys.map(k => k.name.split(':').pop()).sort().reverse(), 200, c);
    }
    return json({ error: 'not found' }, 404, c);
  } catch(e){
    return json({ error: String(e && e.message || e) }, 500, c);
  }
}

/**
 * Cloudflare Worker — Proxy de WooCommerce API
 *
 * Dos zonas:
 *
 *   /products…        Catalogo publico (solo lectura). El Worker agrega las
 *                     API keys de lectura y cachea 5 minutos.
 *
 *   /admin/…          Panel de administracion (admin.html). NO usa las keys:
 *                     reenvia el usuario + contraseña de aplicacion de WordPress
 *                     que manda el navegador, asi WooCommerce aplica los
 *                     permisos de ese usuario (rol "Gestor de tienda").
 *                     Nunca se cachea.
 *
 * Las keys se almacenan como secrets en Cloudflare (NUNCA en este archivo).
 *
 * Deploy:
 *   npm install -g wrangler
 *   wrangler login
 *   wrangler secret put WC_BASE_URL          # ej: https://tienda.lupaecoart.com
 *   wrangler secret put WC_CONSUMER_KEY
 *   wrangler secret put WC_CONSUMER_SECRET
 *   wrangler secret put ALLOWED_ORIGINS      # ej: https://lupaecoart.site,https://70m1dev.github.io
 *   wrangler deploy
 *
 * Desarrollo local:
 *   wrangler dev
 */

// Solo estos endpoints de WooCommerce se pueden pedir a traves del proxy publico.
// Evita que alguien use el Worker para leer /orders, /customers, etc.
const ALLOWED_PATHS = [
    /^\/products$/,
    /^\/products\/\d+$/,
    /^\/products\/categories$/,
];

// Rutas del panel: ruta del Worker → metodos permitidos y destino en WordPress.
// Todo lo que no este aca responde 403, aunque el usuario tenga mas permisos.
const ADMIN_ROUTES = [
    { re: /^\/admin\/me$/, methods: ['GET'], target: () => '/wp-json/wp/v2/users/me' },
    { re: /^\/admin\/products$/, methods: ['GET', 'POST'], target: () => '/wp-json/wc/v3/products' },
    { re: /^\/admin\/products\/(\d+)$/, methods: ['GET', 'PUT', 'DELETE'], target: m => `/wp-json/wc/v3/products/${m[1]}` },
    { re: /^\/admin\/products\/categories$/, methods: ['GET'], target: () => '/wp-json/wc/v3/products/categories' },
    { re: /^\/admin\/media$/, methods: ['POST'], target: () => '/wp-json/wp/v2/media' },
];

// Fotos de celular ya redimensionadas por el panel; esto es solo un tope.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function allowedOrigins(env) {
    return (env.ALLOWED_ORIGINS || '')
        .split(',')
        .map(o => o.trim())
        .filter(Boolean);
}

function corsHeaders(request, env, admin) {
    const origin = request.headers.get('Origin') || '';
    const allowed = allowedOrigins(env);

    // Sin ALLOWED_ORIGINS configurado abrimos a todos (util mientras se prueba).
    const allowOrigin = allowed.length === 0
        ? '*'
        : (allowed.includes(origin) ? origin : allowed[0]);

    return {
        'Access-Control-Allow-Origin': allowOrigin,
        'Access-Control-Allow-Methods': admin ? 'GET, POST, PUT, DELETE, OPTIONS' : 'GET, OPTIONS',
        'Access-Control-Allow-Headers': admin ? 'Authorization, Content-Type, Content-Disposition' : 'Content-Type',
        'Access-Control-Expose-Headers': 'X-WP-Total, X-WP-TotalPages',
        'Access-Control-Max-Age': '600',
        'Vary': 'Origin',
    };
}

function jsonError(message, status, headers) {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json', ...headers },
    });
}

function readBaseUrl(env) {
    // Los secrets cargados por consola pueden traer espacios o saltos de linea
    return (env.WC_BASE_URL || '').trim().replace(/\/+$/, '');
}

// Copia la respuesta de WordPress agregando CORS y la paginacion.
async function relay(resp, cors, cacheControl) {
    const body = await resp.text();
    const contentType = resp.headers.get('Content-Type') || '';

    // WordPress puede devolver HTML (error de PHP, pagina de mantenimiento, etc.)
    if (!contentType.includes('application/json')) {
        return jsonError(`WordPress no devolvio JSON (HTTP ${resp.status})`, 502, cors);
    }

    const headers = { 'Content-Type': 'application/json', 'Cache-Control': cacheControl, ...cors };
    for (const h of ['X-WP-Total', 'X-WP-TotalPages']) {
        const value = resp.headers.get(h);
        if (value) headers[h] = value;
    }
    return new Response(body, { status: resp.status, headers });
}

async function handlePublic(request, env, url) {
    const cors = corsHeaders(request, env, false);

    if (request.method !== 'GET') {
        return jsonError('Solo se permiten requests GET', 405, cors);
    }

    const baseUrl = readBaseUrl(env);
    const consumerKey = (env.WC_CONSUMER_KEY || '').trim();
    const consumerSecret = (env.WC_CONSUMER_SECRET || '').trim();

    if (!baseUrl || !consumerKey || !consumerSecret) {
        return jsonError('El Worker no tiene los secrets configurados', 500, cors);
    }

    if (!ALLOWED_PATHS.some(re => re.test(url.pathname))) {
        return jsonError(`Endpoint no permitido: ${url.pathname}`, 403, cors);
    }

    let wcUrl;
    try {
        wcUrl = new URL(`${baseUrl}/wp-json/wc/v3${url.pathname}`);
    } catch {
        return jsonError('WC_BASE_URL no es una URL valida', 500, cors);
    }
    url.searchParams.forEach((value, key) => {
        // Nunca dejamos que el cliente pise las credenciales
        if (key !== 'consumer_key' && key !== 'consumer_secret') {
            wcUrl.searchParams.set(key, value);
        }
    });
    wcUrl.searchParams.set('consumer_key', consumerKey);
    wcUrl.searchParams.set('consumer_secret', consumerSecret);

    let resp;
    try {
        resp = await fetch(wcUrl.toString(), {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            // Cachea las respuestas de WooCommerce 5 min en el edge
            cf: { cacheTtl: 300, cacheEverything: true },
        });
    } catch (err) {
        return jsonError(`No se pudo contactar a WooCommerce: ${err.message}`, 502, cors);
    }

    return relay(resp, cors, 'public, max-age=300');
}

async function handleAdmin(request, env, url) {
    const cors = corsHeaders(request, env, true);

    // El panel solo se usa desde los origenes propios. Sin Origin (curl, etc.)
    // no hay navegador que proteger, y la contraseña igual es obligatoria.
    const origin = request.headers.get('Origin');
    const allowed = allowedOrigins(env);
    if (origin && allowed.length && !allowed.includes(origin)) {
        return jsonError('Origen no permitido', 403, cors);
    }

    let match = null;
    const route = ADMIN_ROUTES.find(r => (match = url.pathname.match(r.re)));
    if (!route) {
        return jsonError(`Endpoint no permitido: ${url.pathname}`, 403, cors);
    }
    if (!route.methods.includes(request.method)) {
        return jsonError(`Metodo no permitido: ${request.method}`, 405, cors);
    }

    const auth = request.headers.get('Authorization') || '';
    if (!auth.startsWith('Basic ')) {
        return jsonError('Falta iniciar sesion', 401, cors);
    }

    const baseUrl = readBaseUrl(env);
    if (!baseUrl) {
        return jsonError('El Worker no tiene WC_BASE_URL configurado', 500, cors);
    }

    let wpUrl;
    try {
        wpUrl = new URL(`${baseUrl}${route.target(match)}`);
    } catch {
        return jsonError('WC_BASE_URL no es una URL valida', 500, cors);
    }
    url.searchParams.forEach((value, key) => {
        if (key !== 'consumer_key' && key !== 'consumer_secret') {
            wpUrl.searchParams.set(key, value);
        }
    });

    const headers = { 'Accept': 'application/json', 'Authorization': auth };
    let body;
    if (request.method === 'POST' || request.method === 'PUT') {
        const length = Number(request.headers.get('Content-Length') || 0);
        if (length > MAX_UPLOAD_BYTES) {
            return jsonError('El archivo es demasiado grande (maximo 10 MB)', 413, cors);
        }
        headers['Content-Type'] = request.headers.get('Content-Type') || 'application/json';
        const disposition = request.headers.get('Content-Disposition');
        if (disposition) headers['Content-Disposition'] = disposition;
        body = await request.arrayBuffer();
    }

    let resp;
    try {
        resp = await fetch(wpUrl.toString(), {
            method: request.method,
            headers,
            body,
            cf: { cacheTtl: 0, cacheEverything: false },
        });
    } catch (err) {
        return jsonError(`No se pudo contactar a WordPress: ${err.message}`, 502, cors);
    }

    return relay(resp, cors, 'no-store');
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const admin = url.pathname === '/admin' || url.pathname.startsWith('/admin/');

        // CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders(request, env, admin) });
        }

        return admin ? handleAdmin(request, env, url) : handlePublic(request, env, url);
    },
};

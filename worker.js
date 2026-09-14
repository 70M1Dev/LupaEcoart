/**
 * Cloudflare Worker — Proxy de WooCommerce API
 *
 * Tres zonas:
 *
 *   /products…        Catalogo publico (solo lectura). El Worker agrega las
 *                     API keys de lectura y cachea 1 minuto.
 *
 *   /store/…          Checkout (checkout.html). Reenvia a la Store API de
 *                     WooCommerce, que arma el carrito, calcula precios, envio,
 *                     cupones y stock, y crea el pedido. No usa API keys: la
 *                     sesion del carrito viaja en el header Cart-Token.
 *                     Nunca se cachea.
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

// Cache del catalogo publico: los cambios del panel se ven en ~1 minuto.
const PUBLIC_CACHE_SECONDS = 60;

// Rutas del checkout: ruta del Worker → metodos permitidos y destino en la Store API.
const STORE_ROUTES = [
    { re: /^\/store\/cart$/, methods: ['GET'], target: () => '/wp-json/wc/store/v1/cart' },
    { re: /^\/store\/cart\/(add-item|update-item|remove-item|apply-coupon|remove-coupon|update-customer|select-shipping-rate)$/, methods: ['POST'], target: m => `/wp-json/wc/store/v1/cart/${m[1]}` },
    { re: /^\/store\/checkout$/, methods: ['POST'], target: () => '/wp-json/wc/store/v1/checkout' },
];

// Rutas del panel: ruta del Worker → metodos permitidos y destino en WordPress.
// Todo lo que no este aca responde 403, aunque el usuario tenga mas permisos.
const ADMIN_ROUTES = [
    { re: /^\/admin\/me$/, methods: ['GET'], target: () => '/wp-json/wp/v2/users/me' },
    { re: /^\/admin\/products$/, methods: ['GET', 'POST'], target: () => '/wp-json/wc/v3/products' },
    { re: /^\/admin\/products\/(\d+)$/, methods: ['GET', 'PUT', 'DELETE'], target: m => `/wp-json/wc/v3/products/${m[1]}` },
    { re: /^\/admin\/products\/categories$/, methods: ['GET'], target: () => '/wp-json/wc/v3/products/categories' },
    { re: /^\/admin\/media$/, methods: ['POST'], target: () => '/wp-json/wp/v2/media' },
    { re: /^\/admin\/orders$/, methods: ['GET'], target: () => '/wp-json/wc/v3/orders' },
    { re: /^\/admin\/orders\/(\d+)$/, methods: ['GET', 'PUT'], target: m => `/wp-json/wc/v3/orders/${m[1]}` },
    { re: /^\/admin\/orders\/(\d+)\/notes$/, methods: ['GET', 'POST'], target: m => `/wp-json/wc/v3/orders/${m[1]}/notes` },
];

// Fotos de celular ya redimensionadas por el panel; esto es solo un tope.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_STORE_BODY_BYTES = 64 * 1024;

function allowedOrigins(env) {
    return (env.ALLOWED_ORIGINS || '')
        .split(',')
        .map(o => o.trim())
        .filter(Boolean);
}

function zoneOf(pathname) {
    if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'admin';
    if (pathname === '/store' || pathname.startsWith('/store/')) return 'store';
    return 'public';
}

function corsHeaders(request, env, zone) {
    const origin = request.headers.get('Origin') || '';
    const allowed = allowedOrigins(env);

    // Sin ALLOWED_ORIGINS configurado abrimos a todos (util mientras se prueba).
    const allowOrigin = allowed.length === 0
        ? '*'
        : (allowed.includes(origin) ? origin : allowed[0]);

    const byZone = {
        public: { methods: 'GET, OPTIONS', headers: 'Content-Type', expose: 'X-WP-Total, X-WP-TotalPages' },
        store: { methods: 'GET, POST, OPTIONS', headers: 'Content-Type, Cart-Token', expose: 'Cart-Token' },
        admin: { methods: 'GET, POST, PUT, DELETE, OPTIONS', headers: 'Authorization, Content-Type, Content-Disposition', expose: 'X-WP-Total, X-WP-TotalPages' },
    }[zone];

    return {
        'Access-Control-Allow-Origin': allowOrigin,
        'Access-Control-Allow-Methods': byZone.methods,
        'Access-Control-Allow-Headers': byZone.headers,
        'Access-Control-Expose-Headers': byZone.expose,
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

// Copia la respuesta de WordPress agregando CORS, paginacion y extras.
async function relay(resp, cors, cacheControl, passHeaders = ['X-WP-Total', 'X-WP-TotalPages']) {
    const body = await resp.text();
    const contentType = resp.headers.get('Content-Type') || '';

    // WordPress puede devolver HTML (error de PHP, pagina de mantenimiento, etc.)
    if (!contentType.includes('application/json')) {
        return jsonError(`WordPress no devolvio JSON (HTTP ${resp.status})`, 502, cors);
    }

    const headers = { 'Content-Type': 'application/json', 'Cache-Control': cacheControl, ...cors };
    for (const h of passHeaders) {
        const value = resp.headers.get(h);
        if (value) headers[h] = value;
    }
    return new Response(body, { status: resp.status, headers });
}

// Las zonas /store y /admin solo se usan desde los origenes propios. Sin Origin
// (curl, etc.) no hay navegador que proteger.
function originRejected(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = allowedOrigins(env);
    return Boolean(origin && allowed.length && !allowed.includes(origin));
}

function matchRoute(routes, pathname) {
    for (const route of routes) {
        const match = pathname.match(route.re);
        if (match) return { route, match };
    }
    return null;
}

function buildTarget(baseUrl, path, searchParams) {
    const target = new URL(`${baseUrl}${path}`);
    searchParams.forEach((value, key) => {
        // Nunca dejamos que el cliente pise las credenciales
        if (key !== 'consumer_key' && key !== 'consumer_secret') {
            target.searchParams.set(key, value);
        }
    });
    return target;
}

async function handlePublic(request, env, url) {
    const cors = corsHeaders(request, env, 'public');

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
        wcUrl = buildTarget(baseUrl, `/wp-json/wc/v3${url.pathname}`, url.searchParams);
    } catch {
        return jsonError('WC_BASE_URL no es una URL valida', 500, cors);
    }
    wcUrl.searchParams.set('consumer_key', consumerKey);
    wcUrl.searchParams.set('consumer_secret', consumerSecret);

    let resp;
    try {
        resp = await fetch(wcUrl.toString(), {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            cf: { cacheTtl: PUBLIC_CACHE_SECONDS, cacheEverything: true },
        });
    } catch (err) {
        return jsonError(`No se pudo contactar a WooCommerce: ${err.message}`, 502, cors);
    }

    // El navegador revalida siempre: el unico cache es el del edge (1 minuto).
    return relay(resp, cors, 'no-cache');
}

async function handleStore(request, env, url) {
    const cors = corsHeaders(request, env, 'store');

    if (originRejected(request, env)) {
        return jsonError('Origen no permitido', 403, cors);
    }

    const found = matchRoute(STORE_ROUTES, url.pathname);
    if (!found) {
        return jsonError(`Endpoint no permitido: ${url.pathname}`, 403, cors);
    }
    if (!found.route.methods.includes(request.method)) {
        return jsonError(`Metodo no permitido: ${request.method}`, 405, cors);
    }

    const baseUrl = readBaseUrl(env);
    if (!baseUrl) {
        return jsonError('El Worker no tiene WC_BASE_URL configurado', 500, cors);
    }

    let target;
    try {
        target = buildTarget(baseUrl, found.route.target(found.match), url.searchParams);
    } catch {
        return jsonError('WC_BASE_URL no es una URL valida', 500, cors);
    }

    // Solo viaja la sesion del carrito: nada de cookies ni Authorization.
    const headers = { 'Accept': 'application/json' };
    const cartToken = request.headers.get('Cart-Token');
    if (cartToken) headers['Cart-Token'] = cartToken;

    let body;
    if (request.method === 'POST') {
        const length = Number(request.headers.get('Content-Length') || 0);
        if (length > MAX_STORE_BODY_BYTES) {
            return jsonError('Pedido demasiado grande', 413, cors);
        }
        headers['Content-Type'] = 'application/json';
        body = await request.text();
    }

    let resp;
    try {
        resp = await fetch(target.toString(), {
            method: request.method,
            headers,
            body,
            cf: { cacheTtl: 0, cacheEverything: false },
        });
    } catch (err) {
        return jsonError(`No se pudo contactar a WooCommerce: ${err.message}`, 502, cors);
    }

    return relay(resp, cors, 'no-store', ['Cart-Token']);
}

async function handleAdmin(request, env, url) {
    const cors = corsHeaders(request, env, 'admin');

    if (originRejected(request, env)) {
        return jsonError('Origen no permitido', 403, cors);
    }

    const found = matchRoute(ADMIN_ROUTES, url.pathname);
    if (!found) {
        return jsonError(`Endpoint no permitido: ${url.pathname}`, 403, cors);
    }
    if (!found.route.methods.includes(request.method)) {
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
        wpUrl = buildTarget(baseUrl, found.route.target(found.match), url.searchParams);
    } catch {
        return jsonError('WC_BASE_URL no es una URL valida', 500, cors);
    }

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
        const zone = zoneOf(url.pathname);

        // CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders(request, env, zone) });
        }

        if (zone === 'admin') return handleAdmin(request, env, url);
        if (zone === 'store') return handleStore(request, env, url);
        return handlePublic(request, env, url);
    },
};

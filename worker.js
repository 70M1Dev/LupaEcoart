/**
 * Cloudflare Worker — Proxy de WooCommerce API
 *
 * Oculta las API keys de WooCommerce (Consumer Key / Secret)
 * haciendo de proxy inverso.
 *
 * El frontend llama a este Worker (ej: https://api.lupaecoart.com/products)
 * y el Worker agrega las keys antes de reenviar a WooCommerce.
 *
 * Las keys se almacenan como secrets en Cloudflare (NUNCA en este archivo).
 *
 * Deploy:
 *   npm install -g wrangler
 *   wrangler login
 *   wrangler secret put WC_BASE_URL          # ej: https://tienda.lupaecoart.com
 *   wrangler secret put WC_CONSUMER_KEY
 *   wrangler secret put WC_CONSUMER_SECRET
 *   wrangler secret put ALLOWED_ORIGINS      # ej: https://70m1dev.github.io,https://lupaecoart.com
 *   wrangler deploy
 *
 * Desarrollo local:
 *   wrangler dev
 */

// Solo estos endpoints de WooCommerce se pueden pedir a traves del proxy.
// Evita que alguien use el Worker para leer /orders, /customers, etc.
const ALLOWED_PATHS = [
    /^\/products$/,
    /^\/products\/\d+$/,
    /^\/products\/categories$/,
];

function corsHeaders(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '')
        .trim()
        .split(',')
        .map(o => o.trim())
        .filter(Boolean);

    // Sin ALLOWED_ORIGINS configurado abrimos a todos (util mientras se prueba).
    const allowOrigin = allowed.length === 0
        ? '*'
        : (allowed.includes(origin) ? origin : allowed[0]);

    return {
        'Access-Control-Allow-Origin': allowOrigin,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Vary': 'Origin',
    };
}

function jsonError(message, status, headers) {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json', ...headers },
    });
}

export default {
    async fetch(request, env) {
        const cors = corsHeaders(request, env);
        const url = new URL(request.url);

        // CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: cors });
        }

        if (request.method !== 'GET') {
            return jsonError('Solo se permiten requests GET', 405, cors);
        }

        // Los secrets cargados por consola pueden traer espacios o saltos de linea
        const baseUrl = (env.WC_BASE_URL || '').trim().replace(/\/+$/, '');
        const consumerKey = (env.WC_CONSUMER_KEY || '').trim();
        const consumerSecret = (env.WC_CONSUMER_SECRET || '').trim();

        if (!baseUrl || !consumerKey || !consumerSecret) {
            return jsonError('El Worker no tiene los secrets configurados', 500, cors);
        }

        if (!ALLOWED_PATHS.some(re => re.test(url.pathname))) {
            return jsonError(`Endpoint no permitido: ${url.pathname}`, 403, cors);
        }

        // Construir la URL de WooCommerce
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

        // WooCommerce puede devolver HTML (error de PHP, pagina de mantenimiento, etc.)
        const body = await resp.text();
        const contentType = resp.headers.get('Content-Type') || '';
        if (!contentType.includes('application/json')) {
            return jsonError('WooCommerce no devolvio JSON', 502, cors);
        }

        const headers = {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=300',
            ...cors,
        };

        // Paginacion de la WP REST API, por si el frontend la necesita
        for (const h of ['X-WP-Total', 'X-WP-TotalPages']) {
            const value = resp.headers.get(h);
            if (value) headers[h] = value;
        }
        headers['Access-Control-Expose-Headers'] = 'X-WP-Total, X-WP-TotalPages';

        return new Response(body, { status: resp.status, headers });
    },
};

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
 *   /custom/upload    Archivo de personalizacion que sube el cliente desde la
 *                     ficha del producto. Se guarda en Workers KV (binding
 *                     CUSTOM_FILES), privado: solo el panel lo puede descargar.
 *                     Ver "PERSONALIZACIONES" mas abajo.
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

// Rutas del panel que resuelve el propio Worker (personalizaciones en KV).
const ADMIN_CUSTOM_ROUTES = [
    { re: /^\/admin\/orders\/(\d+)\/personalizations$/, methods: ['GET'] },
    { re: /^\/admin\/orders\/(\d+)\/files\/([0-9a-f-]{36})$/, methods: ['GET'] },
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
    if (pathname === '/custom' || pathname.startsWith('/custom/')) return 'custom';
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
        admin: { methods: 'GET, POST, PUT, DELETE, OPTIONS', headers: 'Authorization, Content-Type, Content-Disposition', expose: 'X-WP-Total, X-WP-TotalPages, Content-Disposition' },
        custom: { methods: 'POST, OPTIONS', headers: 'Content-Type, X-File-Name', expose: '' },
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

async function handleStore(request, env, url, ctx) {
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

    // El checkout trae las personalizaciones aparte: WooCommerce no las
    // conoce, asi que se sacan del cuerpo y se validan antes de crear el pedido.
    let personalizations = [];
    if (url.pathname === '/store/checkout') {
        try {
            const data = JSON.parse(body || '{}');
            personalizations = await readPersonalizations(env, data.lupa_personalizations);
            delete data.lupa_personalizations;
            body = JSON.stringify(data);
        } catch (err) {
            return jsonError(err.message || 'Pedido invalido', 400, cors);
        }
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

    // Pedido creado: guardamos las personalizaciones y avisamos por WhatsApp.
    if (url.pathname === '/store/checkout' && resp.ok) {
        const order = await resp.clone().json().catch(() => null);
        if (order && order.order_id) {
            if (personalizations.length) {
                // El pedido ya existe: un fallo aca no lo puede frenar, queda
                // en el log y el texto igual llega en la nota del pedido.
                try {
                    await savePersonalizations(env, order.order_id, personalizations);
                } catch (err) {
                    console.error(`No se guardaron las personalizaciones del pedido ${order.order_id}: ${err.message}`);
                }
            }
            ctx.waitUntil(notifyNewOrder(env, order.order_id));
        }
    }

    return relay(resp, cors, 'no-store', ['Cart-Token']);
}

// ==========================================
// AVISO DE PEDIDOS POR WHATSAPP (CallMeBot)
// ==========================================
// Secrets: CALLMEBOT_PHONE (ej: 59894319604) y CALLMEBOT_APIKEY.
// Sin esos secrets no se manda nada. Si falla, el pedido no se ve afectado.

const ORDER_STATUS_LABELS = {
    pending: 'pendiente de pago',
    'on-hold': 'en espera, confirmar pago',
    processing: 'pagado',
    completed: 'completado',
    cancelled: 'cancelado',
    failed: 'pago fallido',
};

function formatPesos(value) {
    const n = Number(value);
    return `$ ${(isFinite(n) ? n : 0).toLocaleString('es-UY', { maximumFractionDigits: 2 })}`;
}

// Telefono uruguayo del cliente → numero para wa.me (099123456 → 59899123456).
function whatsappDigits(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.startsWith('598') && digits.length >= 11) return digits;
    if (digits.startsWith('09') && digits.length === 9) return `598${digits.slice(1)}`;
    if (digits.startsWith('9') && digits.length === 8) return `598${digits}`;
    return '';
}

async function fetchOrder(env, orderId) {
    const baseUrl = readBaseUrl(env);
    const url = new URL(`${baseUrl}/wp-json/wc/v3/orders/${orderId}`);
    url.searchParams.set('consumer_key', (env.WC_CONSUMER_KEY || '').trim());
    url.searchParams.set('consumer_secret', (env.WC_CONSUMER_SECRET || '').trim());
    const resp = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
}

function orderMessage(order) {
    const b = order.billing || {};
    const s = order.shipping || {};
    const status = ORDER_STATUS_LABELS[order.status] || order.status;
    const lines = [
        `🛒 *Nuevo pedido #${order.number || order.id}*`,
        `Total: *${formatPesos(order.total)}*`,
        `Pago: ${order.payment_method_title || order.payment_method} (${status})`,
        '',
        `Cliente: ${[b.first_name, b.last_name].filter(Boolean).join(' ')}`,
    ];
    if (b.phone) {
        const wa = whatsappDigits(b.phone);
        lines.push(`Tel: ${b.phone}${wa ? ` · wa.me/${wa}` : ''}`);
    }
    if (b.email) lines.push(`Email: ${b.email}`);
    const place = [s.address_1 || b.address_1, s.city || b.city].filter(Boolean).join(', ');
    if (place) lines.push(`Envío: ${place}`);

    lines.push('', '*Productos*');
    (order.line_items || []).forEach(item => lines.push(`- ${item.quantity} × ${item.name}`));
    (order.shipping_lines || []).forEach(line => lines.push(`- ${line.method_title}: ${Number(line.total) === 0 ? 'a coordinar' : formatPesos(line.total)}`));
    (order.coupon_lines || []).forEach(line => lines.push(`- Cupón ${String(line.code).toUpperCase()}: -${formatPesos(line.discount)}`));

    if (order.customer_note) lines.push('', `Nota: ${order.customer_note}`);
    lines.push('', 'Ver en el panel: https://lupaecoart.site/admin');
    return lines.join('\n');
}

async function notifyNewOrder(env, orderId) {
    const phone = (env.CALLMEBOT_PHONE || '').replace(/\D/g, '');
    const apikey = (env.CALLMEBOT_APIKEY || '').trim();
    if (!phone || !apikey) return;

    let text;
    try {
        text = orderMessage(await fetchOrder(env, orderId));
    } catch (err) {
        // Sin detalle del pedido igual avisamos que entro uno.
        console.error(`No se pudo leer el pedido ${orderId}: ${err.message}`);
        text = `🛒 *Nuevo pedido #${orderId}*\nVer en el panel: https://lupaecoart.site/admin`;
    }

    const url = new URL('https://api.callmebot.com/whatsapp.php');
    url.searchParams.set('phone', phone);
    url.searchParams.set('text', text);
    url.searchParams.set('apikey', apikey);
    try {
        const resp = await fetch(url.toString());
        if (!resp.ok) console.error(`CallMeBot respondio ${resp.status}: ${await resp.text()}`);
    } catch (err) {
        console.error(`CallMeBot no respondio: ${err.message}`);
    }
}

// ==========================================
// PERSONALIZACIONES (Workers KV, binding CUSTOM_FILES)
// ==========================================
// 1. El cliente sube el archivo desde la ficha (/custom/upload) y queda como
//    file:<id> con vencimiento corto: si nunca compra, se borra solo.
// 2. En el checkout el frontend manda lupa_personalizations; cuando
//    WooCommerce crea el pedido se guarda order:<id> con los textos y los
//    archivos pasan a vencer en PERSONALIZATION_ORDER_TTL.
// 3. El panel los lee y descarga (/admin/orders/<id>/…) con el usuario de
//    WordPress; al marcar el pedido como completado, cancelado o reembolsado
//    se borra todo. El vencimiento largo es solo el respaldo para pedidos que
//    nunca se cierran desde el panel.

const PERSONALIZATION_UPLOAD_TTL = 7 * 24 * 60 * 60;
const PERSONALIZATION_ORDER_TTL = 180 * 24 * 60 * 60;
const PERSONALIZATION_FINAL_STATUSES = ['completed', 'cancelled', 'refunded'];
const PERSONALIZATION_MAX_TEXT = 1000;
const PERSONALIZATION_MAX_ITEMS = 20;
const PERSONALIZATION_MAX_FILES = 10;         // por pedido
const PERSONALIZATION_MAX_ITEM_FILES = 3;     // por producto (mismo tope que la ficha)
// Fotos, PDF y formatos vectoriales habituales para grabado y corte laser.
const PERSONALIZATION_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'pdf', 'svg', 'ai', 'eps', 'dxf', 'cdr'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function fileExtension(name) {
    const match = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    return match ? match[1] : '';
}

async function handleCustomUpload(request, env, url) {
    const cors = corsHeaders(request, env, 'custom');

    // Sube cualquiera sin iniciar sesion: por lo menos que venga de la tienda.
    const origin = request.headers.get('Origin');
    const allowed = allowedOrigins(env);
    if (allowed.length && !allowed.includes(origin)) {
        return jsonError('Origen no permitido', 403, cors);
    }
    if (url.pathname !== '/custom/upload') {
        return jsonError(`Endpoint no permitido: ${url.pathname}`, 403, cors);
    }
    if (request.method !== 'POST') {
        return jsonError(`Metodo no permitido: ${request.method}`, 405, cors);
    }
    if (!env.CUSTOM_FILES) {
        return jsonError('La tienda todavia no acepta archivos de personalizacion', 503, cors);
    }

    let name = '';
    try { name = decodeURIComponent(request.headers.get('X-File-Name') || ''); } catch { /* nombre invalido */ }
    name = name.replace(/[\\/\r\n"]/g, '_').trim().slice(-120) || 'archivo';
    if (!PERSONALIZATION_EXTENSIONS.includes(fileExtension(name))) {
        return jsonError(`Tipo de archivo no permitido. Usá: ${PERSONALIZATION_EXTENSIONS.join(', ')}`, 415, cors);
    }

    const length = Number(request.headers.get('Content-Length') || 0);
    if (length > MAX_UPLOAD_BYTES) {
        return jsonError('El archivo es demasiado grande (maximo 10 MB)', 413, cors);
    }
    const data = await request.arrayBuffer();
    if (!data.byteLength) return jsonError('El archivo esta vacio', 400, cors);
    if (data.byteLength > MAX_UPLOAD_BYTES) {
        return jsonError('El archivo es demasiado grande (maximo 10 MB)', 413, cors);
    }

    const id = crypto.randomUUID();
    const type = (request.headers.get('Content-Type') || 'application/octet-stream').slice(0, 100);
    await env.CUSTOM_FILES.put(`file:${id}`, data, {
        expirationTtl: PERSONALIZATION_UPLOAD_TTL,
        metadata: { name, type, size: data.byteLength },
    });

    return new Response(JSON.stringify({ id, name, size: data.byteLength }), {
        status: 201,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors },
    });
}

function cleanText(value, max) {
    return String(value ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);
}

// Valida lo que manda el checkout y comprueba que los archivos sigan subidos.
// Lanza con un mensaje para el cliente si algo no cierra.
async function readPersonalizations(env, raw) {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw) || raw.length > PERSONALIZATION_MAX_ITEMS) {
        throw new Error('Personalizaciones invalidas');
    }

    const items = raw.map(item => ({
        product_id: parseInt(item && item.product_id, 10) || 0,
        name: cleanText(item && item.name, 200),
        size: cleanText(item && item.size, 60),
        quantity: Math.max(1, parseInt(item && item.quantity, 10) || 1),
        text: cleanText(item && item.text, PERSONALIZATION_MAX_TEXT),
        fileIds: Array.isArray(item && item.files) ? item.files.map(String) : [],
    })).filter(item => item.text || item.fileIds.length);

    const fileIds = items.flatMap(item => item.fileIds);
    if (!items.length) return [];
    if (fileIds.length > PERSONALIZATION_MAX_FILES || items.some(item => item.fileIds.length > PERSONALIZATION_MAX_ITEM_FILES)) {
        throw new Error('Demasiados archivos de personalizacion');
    }
    if (fileIds.length && !env.CUSTOM_FILES) throw new Error('La tienda todavia no acepta archivos de personalizacion');

    for (const item of items) {
        item.files = [];
        for (const id of item.fileIds) {
            if (!UUID_RE.test(id)) throw new Error('Archivo de personalizacion invalido');
            const { value, metadata } = await env.CUSTOM_FILES.getWithMetadata(`file:${id}`, 'stream');
            if (!value) {
                throw new Error(`El archivo de personalizacion de "${item.name}" venció. Volvé a agregar el producto al carrito con el archivo.`);
            }
            await value.cancel();
            item.files.push({ id, name: (metadata && metadata.name) || 'archivo', type: (metadata && metadata.type) || '', size: (metadata && metadata.size) || 0 });
        }
        delete item.fileIds;
    }
    return items;
}

async function savePersonalizations(env, orderId, items) {
    // Los archivos pasan al vencimiento largo y quedan atados al pedido.
    for (const file of items.flatMap(item => item.files)) {
        const key = `file:${file.id}`;
        const { value, metadata } = await env.CUSTOM_FILES.getWithMetadata(key, 'stream');
        if (!value) continue;
        await env.CUSTOM_FILES.put(key, value, {
            expirationTtl: PERSONALIZATION_ORDER_TTL,
            metadata: { ...(metadata || {}), order: orderId },
        });
    }
    await env.CUSTOM_FILES.put(`order:${orderId}`, JSON.stringify({ created: new Date().toISOString(), items }), {
        expirationTtl: PERSONALIZATION_ORDER_TTL,
    });
}

async function deletePersonalizations(env, orderId) {
    if (!env.CUSTOM_FILES) return;
    const record = await env.CUSTOM_FILES.get(`order:${orderId}`, 'json');
    if (!record) return;
    for (const file of (record.items || []).flatMap(item => item.files || [])) {
        await env.CUSTOM_FILES.delete(`file:${file.id}`);
    }
    await env.CUSTOM_FILES.delete(`order:${orderId}`);
}

// El panel puede ver las personalizaciones solo si su usuario de WordPress
// puede ver el pedido: se lo preguntamos a WooCommerce con sus credenciales.
async function canReadOrder(baseUrl, auth, orderId) {
    const resp = await fetch(`${baseUrl}/wp-json/wc/v3/orders/${orderId}?_fields=id`, {
        headers: { 'Accept': 'application/json', 'Authorization': auth },
        cf: { cacheTtl: 0, cacheEverything: false },
    });
    return resp.status === 200 ? true : resp.status;
}

async function handleAdminCustom(env, found, auth, baseUrl, cors) {
    const orderId = found.match[1];
    const allowed = await canReadOrder(baseUrl, auth, orderId).catch(() => 502);
    if (allowed !== true) {
        return jsonError(allowed === 401 ? 'Falta iniciar sesion' : 'No se pudo verificar el pedido', allowed === 401 ? 401 : 403, cors);
    }
    if (!env.CUSTOM_FILES) return jsonError('Personalizaciones no configuradas en el Worker', 503, cors);

    const record = await env.CUSTOM_FILES.get(`order:${orderId}`, 'json');

    if (!found.match[2]) {
        return new Response(JSON.stringify(record || { items: [] }), {
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors },
        });
    }

    const fileId = found.match[2];
    const listed = record && (record.items || []).some(item => (item.files || []).some(f => f.id === fileId));
    const { value, metadata } = listed
        ? await env.CUSTOM_FILES.getWithMetadata(`file:${fileId}`, 'stream')
        : { value: null, metadata: null };
    if (!value) return jsonError('El archivo ya no existe', 404, cors);

    const name = (metadata && metadata.name) || 'archivo';
    return new Response(value, {
        headers: {
            // Siempre como descarga: nunca se abre un archivo del cliente en el panel.
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'no-store',
            ...cors,
        },
    });
}

async function handleAdmin(request, env, url, ctx) {
    const cors = corsHeaders(request, env, 'admin');

    if (originRejected(request, env)) {
        return jsonError('Origen no permitido', 403, cors);
    }

    const custom = matchRoute(ADMIN_CUSTOM_ROUTES, url.pathname);
    if (custom) {
        if (!custom.route.methods.includes(request.method)) {
            return jsonError(`Metodo no permitido: ${request.method}`, 405, cors);
        }
        const auth = request.headers.get('Authorization') || '';
        if (!auth.startsWith('Basic ')) return jsonError('Falta iniciar sesion', 401, cors);
        const baseUrl = readBaseUrl(env);
        if (!baseUrl) return jsonError('El Worker no tiene WC_BASE_URL configurado', 500, cors);
        return handleAdminCustom(env, custom, auth, baseUrl, cors);
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

    // Pedido finalizado desde el panel: se borran sus archivos y textos.
    const orderMatch = url.pathname.match(/^\/admin\/orders\/(\d+)$/);
    if (orderMatch && request.method === 'PUT' && resp.ok) {
        const order = await resp.clone().json().catch(() => null);
        if (order && PERSONALIZATION_FINAL_STATUSES.includes(order.status)) {
            ctx.waitUntil(deletePersonalizations(env, orderMatch[1]).catch(err =>
                console.error(`No se borraron las personalizaciones del pedido ${orderMatch[1]}: ${err.message}`)));
        }
    }

    return relay(resp, cors, 'no-store');
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const zone = zoneOf(url.pathname);

        // CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders(request, env, zone) });
        }

        if (zone === 'admin') return handleAdmin(request, env, url, ctx);
        if (zone === 'store') return handleStore(request, env, url, ctx);
        if (zone === 'custom') return handleCustomUpload(request, env, url);
        return handlePublic(request, env, url);
    },
};

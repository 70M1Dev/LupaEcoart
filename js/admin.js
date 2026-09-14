// ==========================================
// PANEL DE TIENDA — Lupa Ecoart
// ==========================================
// Habla con el Worker en PROXY_URL/admin/… usando el usuario de WordPress y
// una contraseña de aplicacion. El Worker la reenvia tal cual y WooCommerce
// aplica los permisos de ese usuario: aca no hay ninguna API key.
//
// Modo prueba (solo en local): admin?demo trabaja en memoria con los
// productos de js/demo-data.js, sin tocar la tienda real.
// ==========================================

const ADMIN_PER_PAGE = 20;
const ADMIN_MAX_IMAGE_SIDE = 1600;
const ADMIN_SESSION_KEY = 'lupa-admin-session';
const ADMIN_DEMO = WC_IS_LOCAL_DEV
    && new URLSearchParams(location.search).has('demo')
    && typeof DEMO_PRODUCTS !== 'undefined';

// Mismo criterio que producto.js para encontrar el atributo de medidas.
const SIZE_ATTR_RE = /medida|tama[ñn]o|talle|size/i;
const PLACEHOLDER_IMG = 'https://placehold.co/160x160/E6EBB1/4A501C?text=Sin+foto';

const $ = id => document.getElementById(id);

const state = {
    user: null,
    categories: [],
    products: [],
    total: 0,
    totalPages: 1,
    page: 1,
    loadSeq: 0,
    filters: { search: '', category: '', stock: '' },
    editing: null,   // producto original; null = producto nuevo
    images: [],      // [{ key, id, src, uploading }]
    dirty: false
};

let authToken = null;

// ==========================================
// UTILIDADES
// ==========================================

function esc(text) {
    return String(text ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

// WooCommerce devuelve nombres con entidades HTML (&amp;, &#8211;, …).
function decodeEntities(text) {
    const el = document.createElement('textarea');
    el.innerHTML = String(text || '');
    return el.value;
}

// Descripcion HTML de WooCommerce → texto editable en un textarea.
function htmlToText(html) {
    const withBreaks = String(html || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|h[1-6])>/gi, '\n\n');
    const doc = new DOMParser().parseFromString(withBreaks, 'text/html');
    return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

function textToHtml(text) {
    return String(text || '')
        .trim()
        .split(/\n{2,}/)
        .filter(Boolean)
        .map(p => `<p>${esc(p.trim()).replace(/\n/g, '<br>')}</p>`)
        .join('\n');
}

function toBase64(text) {
    let binary = '';
    new TextEncoder().encode(text).forEach(b => { binary += String.fromCharCode(b); });
    return btoa(binary);
}

function debounce(fn, ms) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

function safeFileName(name, type) {
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[type] || 'jpg';
    const base = wcNormalize(String(name || '').replace(/\.[^.]+$/, ''))
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    return `${base || 'foto'}.${ext}`;
}

// ==========================================
// SESION
// ==========================================
// Por defecto la sesion vive en sessionStorage (se borra al cerrar el navegador).
// Con "Recordarme" pasa a localStorage.

function sessionStores() {
    const stores = [];
    try { stores.push(sessionStorage); } catch { /* bloqueado */ }
    try { stores.push(localStorage); } catch { /* bloqueado */ }
    return stores;
}

const Session = {
    read() {
        for (const store of sessionStores()) {
            try {
                const raw = store.getItem(ADMIN_SESSION_KEY);
                if (raw) return JSON.parse(raw);
            } catch { /* dato corrupto o storage bloqueado */ }
        }
        return null;
    },
    save(data, remember) {
        this.clear();
        try {
            (remember ? localStorage : sessionStorage).setItem(ADMIN_SESSION_KEY, JSON.stringify(data));
        } catch { /* sin storage: la sesion dura hasta recargar */ }
    },
    clear() {
        for (const store of sessionStores()) {
            try { store.removeItem(ADMIN_SESSION_KEY); } catch { /* nada */ }
        }
    }
};

// ==========================================
// API
// ==========================================

class ApiError extends Error {
    constructor(message, status = 0, code = '') {
        super(message);
        this.status = status;
        this.code = code;
    }
}

function friendlyError(status, data) {
    const code = (data && data.code) || '';
    if (['incorrect_password', 'invalid_username', 'invalid_email', 'application_passwords_disabled'].includes(code)) {
        return 'Usuario o contraseña incorrectos.';
    }
    if (code === 'rest_not_logged_in') {
        return 'WordPress no reconoció la clave. Revisá que sea una contraseña de aplicación.';
    }
    if (status === 401) return 'Usuario o contraseña incorrectos.';
    if (status === 403) return 'Tu usuario no tiene permiso para hacer esto.';
    if (status === 413) return 'La foto es demasiado grande.';
    const message = data && (data.message || data.error);
    return message ? decodeEntities(message) : `La tienda respondió con un error (${status}).`;
}

async function api(method, path, { params = {}, body, headers = {} } = {}) {
    if (ADMIN_DEMO) return demoApi(method, path, { params, body });

    const url = new URL(`${WC_CONFIG.PROXY_URL}/admin/${path}`);
    Object.entries(params).forEach(([key, value]) => {
        if (value !== '' && value !== null && value !== undefined) url.searchParams.set(key, value);
    });

    const init = { method, headers: { Authorization: `Basic ${authToken}`, ...headers } };
    if (body instanceof Blob) {
        init.body = body;
    } else if (body !== undefined) {
        init.body = JSON.stringify(body);
        init.headers['Content-Type'] = 'application/json';
    }

    let res;
    try {
        res = await fetch(url, init);
    } catch {
        throw new ApiError('No hay conexión con la tienda. Revisá internet y probá de nuevo.');
    }

    let data = null;
    try { data = await res.json(); } catch { /* respuesta vacia */ }

    if (!res.ok) throw new ApiError(friendlyError(res.status, data), res.status, data && data.code);

    return {
        data,
        total: Number(res.headers.get('X-WP-Total') || 0),
        totalPages: Number(res.headers.get('X-WP-TotalPages') || 0)
    };
}

// Errores durante el uso: si la clave dejo de valer, volvemos al login.
function handleError(err) {
    if (err.status === 401) {
        logout('Tu sesión venció o la clave fue revocada. Ingresá de nuevo.');
        return;
    }
    toast(err.message, 'error');
    if (!(err instanceof ApiError)) console.error('[LupaEcoart admin]', err);
}

// ==========================================
// MODO PRUEBA (solo local)
// ==========================================

let demoStore = null;

function demoInit() {
    const categories = Object.keys(WC_CATEGORIES).map((slug, i) => ({ id: i + 1, slug, name: WC_CATEGORIES[slug] }));
    demoStore = {
        nextId: 1000,
        categories,
        products: DEMO_PRODUCTS.map(p => demoApply({
            ...structuredClone(p),
            status: 'publish',
            manage_stock: false,
            stock_quantity: null,
            sale_price: p.on_sale ? p.price : '',
            images: p.images.map((img, i) => ({ id: p.id * 10 + i, src: img.src })),
            categories: p.categories.map(c => categories.find(cat => cat.slug === c.slug)).filter(Boolean)
        }, {}))
    };
}

function demoApply(product, body) {
    Object.assign(product, structuredClone(body));
    if (body.categories) {
        product.categories = body.categories.map(c => demoStore.categories.find(cat => cat.id === c.id)).filter(Boolean);
    }
    const regular = parseFloat(product.regular_price) || 0;
    const sale = parseFloat(product.sale_price);
    product.on_sale = sale > 0 && sale < regular;
    product.price = String(product.on_sale ? sale : regular);
    if (product.manage_stock) {
        product.stock_status = product.stock_quantity > 0 ? 'instock' : 'outofstock';
    }
    return product;
}

async function demoApi(method, path, { params, body }) {
    await new Promise(r => setTimeout(r, 250));
    if (!demoStore) demoInit();
    const store = demoStore;
    const one = data => ({ data, total: 0, totalPages: 0 });

    if (path === 'me') return one({ id: 1, name: 'Tienda de prueba', roles: ['shop_manager'] });
    if (path === 'products/categories') return one(store.categories);
    if (path === 'media') return one({ id: store.nextId++, source_url: URL.createObjectURL(body) });

    if (path === 'products' && method === 'GET') {
        const search = wcNormalize(params.search);
        const list = store.products.filter(p =>
            (!search || wcNormalize(p.name).includes(search)) &&
            (!params.category || p.categories.some(c => String(c.id) === String(params.category))) &&
            (!params.stock_status || p.stock_status === params.stock_status)
        );
        const perPage = Number(params.per_page) || ADMIN_PER_PAGE;
        const page = Number(params.page) || 1;
        return {
            data: list.slice((page - 1) * perPage, page * perPage),
            total: list.length,
            totalPages: Math.max(1, Math.ceil(list.length / perPage))
        };
    }

    if (path === 'products' && method === 'POST') {
        const product = demoApply({ id: store.nextId++, date_created: new Date().toISOString(), attributes: [] }, body);
        store.products.unshift(product);
        return one(product);
    }

    const byId = path.match(/^products\/(\d+)$/);
    if (byId) {
        const product = store.products.find(p => p.id === Number(byId[1]));
        if (!product) throw new ApiError('Producto no encontrado.', 404);
        if (method === 'GET') return one(product);
        if (method === 'PUT') return one(demoApply(product, body));
        if (method === 'DELETE') {
            store.products = store.products.filter(p => p !== product);
            return one(product);
        }
    }

    throw new ApiError(`Sin datos de prueba para ${method} ${path}`, 404);
}

// ==========================================
// INTERFAZ GENERAL
// ==========================================

function toast(message, type = 'ok') {
    const el = document.createElement('div');
    el.className = `rounded-xl px-4 py-3 shadow-lg text-sm font-medium text-white ${type === 'error' ? 'bg-red-700' : 'bg-primary-800'}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.textContent = message;
    $('toasts').appendChild(el);
    setTimeout(() => el.remove(), type === 'error' ? 7000 : 4500);
}

function confirmDialog(title, text, okLabel) {
    return new Promise(resolve => {
        const modal = $('confirm-modal');
        $('confirm-title').textContent = title;
        $('confirm-text').textContent = text;
        $('confirm-ok').textContent = okLabel;
        modal.hidden = false;
        $('confirm-ok').focus();

        const close = result => {
            modal.hidden = true;
            $('confirm-ok').removeEventListener('click', onOk);
            $('confirm-cancel').removeEventListener('click', onCancel);
            modal.removeEventListener('click', onBackdrop);
            document.removeEventListener('keydown', onKey);
            resolve(result);
        };
        const onOk = () => close(true);
        const onCancel = () => close(false);
        const onBackdrop = e => { if (e.target === modal) close(false); };
        const onKey = e => { if (e.key === 'Escape') close(false); };

        $('confirm-ok').addEventListener('click', onOk);
        $('confirm-cancel').addEventListener('click', onCancel);
        modal.addEventListener('click', onBackdrop);
        document.addEventListener('keydown', onKey);
    });
}

function showLogin(message) {
    $('view-app').hidden = true;
    $('view-login').hidden = false;
    $('login-demo').hidden = !ADMIN_DEMO;
    $('login-error').hidden = !message;
    $('login-error').textContent = message || '';
    $('login-user').focus();
}

function showView(name) {
    $('view-login').hidden = true;
    $('view-app').hidden = false;
    $('view-catalog').hidden = name !== 'catalog';
    $('view-editor').hidden = name !== 'editor';
    window.scrollTo(0, 0);
}

// ==========================================
// LOGIN
// ==========================================

async function verifyUser() {
    const { data } = await api('GET', 'me', { params: { context: 'edit' } });
    const roles = Array.isArray(data.roles) ? data.roles : null;
    if (roles && !roles.some(r => r === 'administrator' || r === 'shop_manager')) {
        throw new ApiError('Tu usuario no tiene permisos de tienda. Tiene que tener el rol "Gestor de tienda".', 403);
    }
    return data;
}

async function onLoginSubmit(e) {
    e.preventDefault();
    const user = $('login-user').value.trim();
    const pass = $('login-pass').value.trim();
    if (!user || !pass) {
        showLogin('Completá usuario y contraseña.');
        return;
    }
    if (!ADMIN_DEMO && !WC_CONFIG.PROXY_URL) {
        showLogin('El panel no está conectado: falta PROXY_URL en js/config.js.');
        return;
    }

    const button = $('login-submit');
    button.disabled = true;
    button.textContent = 'Ingresando…';
    authToken = toBase64(`${user}:${pass}`);

    try {
        const me = await verifyUser();
        Session.save({ token: authToken, name: me.name }, $('login-remember').checked);
        $('login-pass').value = '';
        await enterApp(me);
    } catch (err) {
        authToken = null;
        showLogin(err.message);
    } finally {
        button.disabled = false;
        button.textContent = 'Ingresar';
    }
}

async function enterApp(me) {
    state.user = me;
    $('user-name').textContent = decodeEntities(me.name || '');
    showView('catalog');
    await loadCategories();
    loadCatalog();
}

function logout(message) {
    Session.clear();
    authToken = null;
    state.user = null;
    state.dirty = false;
    showLogin(message);
}

// ==========================================
// CATEGORIAS
// ==========================================

async function loadCategories() {
    try {
        const { data } = await api('GET', 'products/categories', { params: { per_page: 100, orderby: 'name' } });
        state.categories = data
            .filter(c => c.slug !== 'uncategorized' && c.slug !== 'sin-categorizar')
            .map(c => ({ id: c.id, slug: c.slug, name: decodeEntities(c.name) }));
    } catch (err) {
        state.categories = [];
        handleError(err);
    }

    $('filter-category').innerHTML = '<option value="">Todas las categorías</option>' +
        state.categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

function fillCategorySelect(select, selectedId) {
    select.innerHTML = '<option value="">Elegí una categoría</option>' +
        state.categories.map(c =>
            `<option value="${c.id}" ${String(c.id) === String(selectedId) ? 'selected' : ''}>${esc(c.name)}</option>`
        ).join('');
}

// ==========================================
// CATALOGO
// ==========================================

function stockMode(product) {
    if (product.manage_stock) return 'qty';
    return product.stock_status === 'outofstock' ? 'outofstock' : 'instock';
}

function stockPayload(mode, qty) {
    if (mode === 'qty') {
        return { manage_stock: true, stock_quantity: Math.max(0, parseInt(qty, 10) || 0) };
    }
    return { manage_stock: false, stock_status: mode };
}

function productRow(p) {
    const image = (p.images && p.images[0]) ? (p.images[0].thumbnail || p.images[0].src) : PLACEHOLDER_IMG;
    const category = p.categories && p.categories[0];
    const regular = parseFloat(p.regular_price) || 0;
    const sale = parseFloat(p.sale_price);
    const onSale = sale > 0 && sale < regular;
    const mode = stockMode(p);

    const price = onSale
        ? `<span class="font-semibold text-black">${wcPrice(sale)}</span> <s>${wcPrice(regular)}</s>`
        : `<span class="font-semibold text-black">${wcPrice(regular)}</span>`;

    const badges = [
        p.status !== 'publish' ? '<span class="badge bg-neutral-200 text-neutral-700">Borrador</span>' : '',
        p.featured ? '<span class="badge bg-accent/20 text-mustard">★ Destacado</span>' : '',
        onSale ? '<span class="badge bg-teal/25 text-primary-900">Oferta</span>' : '',
        p.stock_status === 'outofstock' ? '<span class="badge bg-red-100 text-red-700">Agotado</span>' : ''
    ].join('');

    return `
        <article class="card p-4 flex flex-col md:flex-row md:items-center gap-4" data-id="${p.id}">
            <div class="flex items-center gap-4 flex-1 min-w-0">
                <img src="${esc(image)}" alt="" loading="lazy" class="w-16 h-16 rounded-xl object-cover bg-neutral-100 flex-shrink-0">
                <div class="min-w-0">
                    <h3 class="font-semibold truncate">${esc(decodeEntities(p.name))}</h3>
                    <p class="text-sm text-neutral-500">${esc(category ? decodeEntities(category.name) : 'Sin categoría')} · ${price}</p>
                    <div class="flex flex-wrap gap-1 mt-1">${badges}</div>
                </div>
            </div>
            <div class="flex flex-wrap items-center gap-2">
                <select class="input !w-auto !py-2 text-sm" data-stock-mode aria-label="Stock de ${esc(decodeEntities(p.name))}">
                    <option value="instock" ${mode === 'instock' ? 'selected' : ''}>Disponible</option>
                    <option value="outofstock" ${mode === 'outofstock' ? 'selected' : ''}>Agotado</option>
                    <option value="qty" ${mode === 'qty' ? 'selected' : ''}>Cantidad</option>
                </select>
                <input type="number" min="0" step="1" inputmode="numeric" class="input !w-20 !py-2 text-sm"
                       data-stock-qty value="${p.stock_quantity ?? 0}" aria-label="Unidades" ${mode === 'qty' ? '' : 'hidden'}>
                <button type="button" class="btn-primary !px-4 !py-2 text-sm" data-stock-save hidden>Guardar stock</button>
                <button type="button" class="btn-ghost !px-4 !py-2 text-sm" data-edit>Editar</button>
            </div>
        </article>`;
}

async function loadCatalog() {
    const seq = ++state.loadSeq;
    const list = $('product-list');
    list.innerHTML = '<div class="card p-8 text-center text-neutral-500">Cargando productos…</div>';
    $('pagination').hidden = true;

    try {
        const { data, total, totalPages } = await api('GET', 'products', {
            params: {
                per_page: ADMIN_PER_PAGE,
                page: state.page,
                status: 'any',
                orderby: 'date',
                order: 'desc',
                search: state.filters.search,
                category: state.filters.category,
                stock_status: state.filters.stock
            }
        });
        if (seq !== state.loadSeq) return; // llego una busqueda mas nueva

        state.products = data;
        state.total = total || data.length;
        state.totalPages = Math.max(1, totalPages || 1);
        renderCatalog();
    } catch (err) {
        if (seq !== state.loadSeq) return;
        list.innerHTML = `
            <div class="card p-8 text-center">
                <p class="font-semibold mb-1">No pudimos cargar los productos</p>
                <p class="text-sm text-neutral-500 mb-4">${esc(err.message)}</p>
                <button type="button" class="btn-ghost" data-retry>Reintentar</button>
            </div>`;
        $('catalog-count').textContent = '';
        if (err.status === 401) handleError(err);
    }
}

function renderCatalog() {
    const { products, total, page, totalPages } = state;
    const filtering = state.filters.search || state.filters.category || state.filters.stock;

    $('catalog-count').textContent = total === 1 ? '1 producto' : `${total} productos`;

    $('product-list').innerHTML = products.length
        ? products.map(productRow).join('')
        : `<div class="card p-8 text-center text-neutral-500">
               ${filtering ? 'Ningún producto coincide con los filtros.' : 'Todavía no hay productos. Creá el primero con “+ Nuevo producto”.'}
           </div>`;

    $('pagination').hidden = totalPages <= 1;
    $('page-info').textContent = `Página ${page} de ${totalPages}`;
    $('page-prev').disabled = page <= 1;
    $('page-next').disabled = page >= totalPages;
}

function findProduct(id) {
    return state.products.find(p => p.id === Number(id));
}

function onStockControlChange(e) {
    const row = e.target.closest('article[data-id]');
    if (!row) return;
    const product = findProduct(row.dataset.id);
    const mode = row.querySelector('[data-stock-mode]').value;
    const qtyInput = row.querySelector('[data-stock-qty]');
    qtyInput.hidden = mode !== 'qty';

    const changed = mode !== stockMode(product) ||
        (mode === 'qty' && (parseInt(qtyInput.value, 10) || 0) !== (product.stock_quantity ?? 0));
    row.querySelector('[data-stock-save]').hidden = !changed;
}

async function onProductListClick(e) {
    if (e.target.closest('[data-retry]')) {
        loadCatalog();
        return;
    }

    const row = e.target.closest('article[data-id]');
    if (!row) return;
    const product = findProduct(row.dataset.id);

    if (e.target.closest('[data-edit]')) {
        openEditor(product);
        return;
    }

    const saveBtn = e.target.closest('[data-stock-save]');
    if (saveBtn) {
        const mode = row.querySelector('[data-stock-mode]').value;
        const qty = row.querySelector('[data-stock-qty]').value;
        saveBtn.disabled = true;
        saveBtn.textContent = 'Guardando…';
        try {
            const { data } = await api('PUT', `products/${product.id}`, { body: stockPayload(mode, qty) });
            state.products[state.products.indexOf(product)] = data;
            row.outerHTML = productRow(data);
            toast(`Stock de "${decodeEntities(data.name)}" actualizado.`);
        } catch (err) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Guardar stock';
            handleError(err);
        }
    }
}

// ==========================================
// EDITOR
// ==========================================

function openEditor(product) {
    const p = product || {};
    state.editing = product || null;

    $('editor-title').textContent = product ? 'Editar producto' : 'Nuevo producto';
    $('f-name').value = decodeEntities(p.name || '');
    fillCategorySelect($('f-category'), p.categories && p.categories[0] && p.categories[0].id);

    const description = htmlToText(p.description || p.short_description || '');
    $('f-description').value = description;
    $('f-description').dataset.original = description;

    $('f-price').value = p.regular_price || '';
    $('f-sale').value = p.sale_price || '';

    const sizeAttr = (p.attributes || []).find(a => SIZE_ATTR_RE.test(a.name));
    const sizes = sizeAttr ? sizeAttr.options.join(', ') : '';
    $('f-sizes').value = sizes;
    $('f-sizes').dataset.original = sizes;

    $('f-stock-mode').value = product ? stockMode(p) : 'instock';
    $('f-stock-qty').value = p.stock_quantity ?? 1;
    $('f-stock-qty-wrap').hidden = $('f-stock-mode').value !== 'qty';

    $('f-published').checked = product ? p.status === 'publish' : true;
    $('f-featured').checked = !!p.featured;

    state.images = (p.images || []).map(img => ({
        key: `img-${img.id}`, id: img.id, src: img.thumbnail || img.src, uploading: false
    }));
    renderImages();

    $('editor-delete').hidden = !product;
    $('editor-error').hidden = true;
    state.dirty = false;
    updateSaveButton();
    showView('editor');
    if (!product) $('f-name').focus();
}

function renderImages() {
    const last = state.images.length - 1;
    const arrow = 'w-7 h-7 rounded-full bg-white/90 shadow text-sm font-bold disabled:opacity-30';

    $('image-grid').innerHTML = state.images.map((img, i) => `
        <div class="relative aspect-square rounded-xl overflow-hidden bg-neutral-100 border-2 ${i === 0 ? 'border-primary-500' : 'border-transparent'}" data-key="${img.key}">
            <img src="${esc(img.src)}" alt="Foto ${i + 1}" class="w-full h-full object-cover ${img.uploading ? 'opacity-40' : ''}">
            ${i === 0 ? '<span class="absolute top-1 left-1 badge bg-primary-700 text-white">Principal</span>' : ''}
            ${img.uploading
                ? '<span class="absolute inset-0 flex items-center justify-center text-xs font-semibold text-primary-900">Subiendo…</span>'
                : `<div class="absolute bottom-1 inset-x-1 flex justify-between">
                       <button type="button" class="${arrow}" data-img-action="left" aria-label="Mover antes" ${i === 0 ? 'disabled' : ''}>‹</button>
                       <button type="button" class="${arrow} text-red-700" data-img-action="remove" aria-label="Quitar foto">✕</button>
                       <button type="button" class="${arrow}" data-img-action="right" aria-label="Mover después" ${i === last ? 'disabled' : ''}>›</button>
                   </div>`}
        </div>`).join('') + `
        <label class="aspect-square rounded-xl border-2 border-dashed border-primary-300 hover:bg-primary-50 flex flex-col items-center justify-center text-primary-700 text-sm font-semibold cursor-pointer transition text-center p-2">
            <span class="text-2xl leading-none mb-1">+</span>
            Agregar fotos
            <input type="file" accept="image/*" multiple class="sr-only" data-image-input>
        </label>`;
}

// Achica fotos de celular antes de subirlas: menos espera y menos disco en el hosting.
async function prepareImage(file) {
    if (!file.type.startsWith('image/')) {
        throw new ApiError(`"${file.name}" no es una imagen.`);
    }

    let bitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch {
        if (/^image\/(jpeg|png|webp|gif)$/.test(file.type)) return file;
        throw new ApiError(`No se pudo leer "${file.name}". Probá con una foto JPG o PNG.`);
    }

    const scale = Math.min(1, ADMIN_MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= 1.5 * 1024 * 1024 && /^image\/(jpeg|png|webp)$/.test(file.type)) {
        bitmap.close();
        return file;
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF'; // las transparencias de PNG quedan en blanco
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) throw new ApiError(`No se pudo procesar "${file.name}".`);
    return blob;
}

async function addImages(files) {
    const entries = files.map((file, i) => ({
        key: `new-${Date.now()}-${i}`, id: null, src: URL.createObjectURL(file), uploading: true, file
    }));
    state.images.push(...entries);
    state.dirty = true;
    renderImages();
    updateSaveButton();

    for (const entry of entries) {
        try {
            const blob = await prepareImage(entry.file);
            const { data } = await api('POST', 'media', {
                body: blob,
                headers: {
                    'Content-Type': blob.type,
                    'Content-Disposition': `attachment; filename="${safeFileName(entry.file.name, blob.type)}"`
                }
            });
            entry.id = data.id;
            entry.uploading = false;
            delete entry.file;
        } catch (err) {
            state.images = state.images.filter(img => img !== entry);
            handleError(err);
        }
        renderImages();
        updateSaveButton();
    }
}

function onImageGridClick(e) {
    const button = e.target.closest('[data-img-action]');
    if (!button) return;
    const index = state.images.findIndex(img => img.key === button.closest('[data-key]').dataset.key);
    if (index < 0) return;

    const action = button.dataset.imgAction;
    const images = state.images;
    if (action === 'remove') images.splice(index, 1);
    if (action === 'left' && index > 0) [images[index - 1], images[index]] = [images[index], images[index - 1]];
    if (action === 'right' && index < images.length - 1) [images[index + 1], images[index]] = [images[index], images[index + 1]];

    state.dirty = true;
    renderImages();
}

function updateSaveButton() {
    const uploading = state.images.some(img => img.uploading);
    $('editor-save').disabled = uploading;
    $('editor-save').textContent = uploading ? 'Subiendo fotos…' : 'Guardar';
}

function showEditorError(message, field) {
    $('editor-error').textContent = message;
    $('editor-error').hidden = false;
    if (field) {
        $(field).focus();
    } else {
        $('editor-error').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

// Devuelve [mensaje, id del campo] del primer error, o null.
function validateEditor() {
    const price = parseFloat($('f-price').value);
    const saleRaw = $('f-sale').value.trim();
    const sale = parseFloat(saleRaw);

    if (!$('f-name').value.trim()) return ['Poné un nombre al producto.', 'f-name'];
    if (!$('f-category').value) return ['Elegí una categoría.', 'f-category'];
    if (!(price > 0)) return ['El precio tiene que ser mayor a 0.', 'f-price'];
    if (saleRaw && !(sale > 0 && sale < price)) {
        return ['El precio de oferta tiene que ser menor que el precio normal.', 'f-sale'];
    }
    if ($('f-stock-mode').value === 'qty') {
        const qty = Number($('f-stock-qty').value);
        if (!Number.isInteger(qty) || qty < 0) return ['Las unidades tienen que ser un número entero, 0 o más.', 'f-stock-qty'];
    }
    return null;
}

function buildPayload() {
    const original = state.editing;
    const saleRaw = $('f-sale').value.trim();

    const payload = {
        name: $('f-name').value.trim(),
        status: $('f-published').checked ? 'publish' : 'draft',
        featured: $('f-featured').checked,
        regular_price: String(parseFloat($('f-price').value)),
        sale_price: saleRaw ? String(parseFloat(saleRaw)) : '',
        categories: [{ id: Number($('f-category').value) }],
        images: state.images.map(img => (ADMIN_DEMO ? { id: img.id, src: img.src } : { id: img.id })),
        ...stockPayload($('f-stock-mode').value, $('f-stock-qty').value)
    };

    if (!original) payload.type = 'simple';

    // La descripcion solo se reescribe si se toco: asi no se pierde formato
    // (negritas, listas) que se haya cargado desde WordPress.
    const description = $('f-description').value;
    if (!original || description !== $('f-description').dataset.original) {
        payload.description = textToHtml(description);
    }

    // Igual con los atributos: se reemplaza solo el de medidas y se conservan los demas.
    const sizesText = $('f-sizes').value;
    if (!original || sizesText !== $('f-sizes').dataset.original) {
        const sizes = sizesText.split(',').map(s => s.trim()).filter(Boolean);
        const attributes = ((original && original.attributes) || []).filter(a => !SIZE_ATTR_RE.test(a.name));
        if (sizes.length) {
            attributes.push({ name: 'Medida', options: sizes, visible: true, variation: false });
        }
        payload.attributes = attributes;
    }

    return payload;
}

async function onEditorSubmit(e) {
    e.preventDefault();
    $('editor-error').hidden = true;

    if (state.images.some(img => img.uploading)) {
        toast('Esperá a que terminen de subir las fotos.');
        return;
    }

    const error = validateEditor();
    if (error) {
        showEditorError(...error);
        return;
    }

    const button = $('editor-save');
    button.disabled = true;
    button.textContent = 'Guardando…';

    try {
        const payload = buildPayload();
        const { data } = state.editing
            ? await api('PUT', `products/${state.editing.id}`, { body: payload })
            : await api('POST', 'products', { body: payload });

        const verb = state.editing ? 'actualizado' : 'creado';
        if (!state.editing) state.page = 1;
        state.dirty = false;
        state.editing = null;
        showView('catalog');
        loadCatalog();
        toast(`"${decodeEntities(data.name)}" ${verb}. En la tienda se ve en hasta 5 minutos.`);
    } catch (err) {
        if (err.status === 401) {
            handleError(err);
        } else {
            showEditorError(err.message);
        }
    } finally {
        updateSaveButton();
    }
}

async function leaveEditor() {
    if (state.dirty) {
        const discard = await confirmDialog('¿Descartar cambios?', 'Los cambios que no guardaste se van a perder.', 'Descartar');
        if (!discard) return;
    }
    state.dirty = false;
    state.editing = null;
    showView('catalog');
}

async function onDeleteProduct() {
    const product = state.editing;
    if (!product) return;

    const name = decodeEntities(product.name);
    const ok = await confirmDialog(
        '¿Eliminar producto?',
        `"${name}" deja de verse en la tienda y pasa a la papelera de WordPress, desde donde se puede recuperar.`,
        'Eliminar'
    );
    if (!ok) return;

    const button = $('editor-delete');
    button.disabled = true;
    try {
        await api('DELETE', `products/${product.id}`);
        state.dirty = false;
        state.editing = null;
        showView('catalog');
        loadCatalog();
        toast(`"${name}" eliminado.`);
    } catch (err) {
        handleError(err);
    } finally {
        button.disabled = false;
    }
}

// ==========================================
// ARRANQUE
// ==========================================

function bindEvents() {
    $('login-form').addEventListener('submit', onLoginSubmit);
    $('logout-btn').addEventListener('click', async () => {
        if (state.dirty && !(await confirmDialog('¿Salir sin guardar?', 'Los cambios que no guardaste se van a perder.', 'Salir'))) return;
        logout();
    });

    $('new-product-btn').addEventListener('click', () => openEditor(null));

    $('filter-search').addEventListener('input', debounce(e => {
        state.filters.search = e.target.value.trim();
        state.page = 1;
        loadCatalog();
    }, 350));
    $('filter-category').addEventListener('change', e => {
        state.filters.category = e.target.value;
        state.page = 1;
        loadCatalog();
    });
    $('filter-stock').addEventListener('change', e => {
        state.filters.stock = e.target.value;
        state.page = 1;
        loadCatalog();
    });
    $('page-prev').addEventListener('click', () => { state.page--; loadCatalog(); });
    $('page-next').addEventListener('click', () => { state.page++; loadCatalog(); });

    const list = $('product-list');
    list.addEventListener('click', onProductListClick);
    list.addEventListener('change', onStockControlChange);
    list.addEventListener('input', onStockControlChange);

    const form = $('editor-form');
    form.addEventListener('submit', onEditorSubmit);
    form.addEventListener('input', () => { state.dirty = true; });
    form.addEventListener('change', e => {
        state.dirty = true;
        if (e.target.matches('[data-image-input]')) {
            const files = [...e.target.files];
            e.target.value = '';
            if (files.length) addImages(files);
        }
    });
    $('f-stock-mode').addEventListener('change', e => {
        $('f-stock-qty-wrap').hidden = e.target.value !== 'qty';
    });
    $('image-grid').addEventListener('click', onImageGridClick);
    $('editor-back').addEventListener('click', leaveEditor);
    $('editor-cancel').addEventListener('click', leaveEditor);
    $('editor-delete').addEventListener('click', onDeleteProduct);

    window.addEventListener('beforeunload', e => {
        if (state.dirty) e.preventDefault();
    });
}

async function init() {
    bindEvents();

    const saved = Session.read();
    if (!saved || !saved.token) {
        showLogin();
        return;
    }

    authToken = saved.token;
    try {
        await enterApp(await verifyUser());
    } catch (err) {
        if (err.status === 401 || err.status === 403) {
            logout(err.status === 401 ? 'Tu sesión venció. Ingresá de nuevo.' : err.message);
        } else {
            showLogin(err.message);
        }
    }
}

init();

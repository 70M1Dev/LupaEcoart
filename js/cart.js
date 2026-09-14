// ==========================================
// CARRITO COMPARTIDO (localStorage)
// Usado por index.html, productos.html, producto.html y carrito.html
// ==========================================

const CART_STORAGE_KEY = 'cart';

// Leer el carrito actual
function getCart() {
    return JSON.parse(localStorage.getItem(CART_STORAGE_KEY)) || [];
}

// Guardar el carrito y refrescar los contadores en pantalla
function saveCartToStorage(cart) {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    updateCartCounters();
}

// Actualiza cualquier contador de carrito presente en la página actual
// (nav desktop, drawer mobile, etc. - busca por id conocido)
function updateCartCounters() {
    const cart = getCart();
    const total = cart.reduce((sum, item) => sum + (item.quantity || 1), 0);

    ['cart-count-nav', 'cart-count-drawer', 'cart-count-mobile'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = total;
    });
}

// Botón flotante de carrito para mobile (en desktop el carrito está en el navbar).
// No se muestra en páginas con <body data-cart-widget="off"> (carrito, checkout).
function setupMobileCartWidget() {
    if (document.body.dataset.cartWidget === 'off') return;
    const widget = document.createElement('a');
    widget.href = 'carrito';
    widget.setAttribute('aria-label', 'Ver carrito');
    widget.className = 'md:hidden fixed bottom-5 right-5 z-30 h-14 w-14 rounded-full bg-primary-700 hover:bg-primary-800 text-white shadow-xl flex items-center justify-center transition';
    widget.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
                  d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007z"/>
        </svg>
        <span id="cart-count-mobile" class="absolute -top-1 -right-1 bg-accent text-black text-xs font-bold rounded-full min-w-[1.25rem] h-5 px-1 flex items-center justify-center">0</span>
    `;
    document.body.appendChild(widget);
}

// Unidades de un producto que ya estan en el carrito, sumando todas las medidas:
// en WooCommerce el stock es del producto, no de cada medida.
function cartQuantityFor(productId, cart = getCart()) {
    return cart
        .filter(item => item.id === productId)
        .reduce((sum, item) => sum + (item.quantity || 1), 0);
}

// Añade un producto al carrito (o suma cantidad si ya existe con la misma medida).
// product = { id, name, price, image, size (opcional), quantity (opcional, default 1),
//             maxQty (opcional: unidades en stock, ver wcStockLimit) }
// Nunca deja pasar del stock. Devuelve cuantas unidades agrego.
function addToCart(product) {
    const cart = getCart();
    const size = product.size || null;
    const wanted = product.quantity || 1;
    const limit = Number.isFinite(product.maxQty) ? product.maxQty : WC_MAX_QTY;
    const available = Math.max(0, limit - cartQuantityFor(product.id, cart));

    if (available === 0) {
        showCartNotification(limit === 0
            ? `${product.name} está sin stock`
            : `Ya tenés en el carrito todas las unidades disponibles de ${product.name}`, 'warning');
        return 0;
    }

    const qty = Math.min(wanted, available);
    const existing = cart.find(item => item.id === product.id && item.size === size);

    if (existing) {
        existing.quantity = (existing.quantity || 1) + qty;
    } else {
        cart.push({
            id: product.id,
            name: product.name,
            price: product.price,
            image: product.image,
            size: size,
            quantity: qty
        });
    }
    cart.forEach(item => { if (item.id === product.id) item.maxQty = limit; });

    saveCartToStorage(cart);
    if (qty < wanted) {
        showCartNotification(`Agregamos ${qty} de ${product.name}: no hay más stock`, 'warning');
    } else {
        showCartNotification(`${product.name}${size ? ` (${size})` : ''} añadido al carrito`);
    }
    return qty;
}

// Vuelve a consultar WooCommerce y ajusta el carrito al stock actual: baja
// cantidades y quita lo que se agoto o se despublico. Devuelve los cambios
// hechos [{ name, size, before, after, limit, managed }]. Si la API falla, no toca nada.
async function refreshCartStock() {
    const cart = getCart();
    const ids = [...new Set(cart.map(item => item.id))];
    if (!ids.length) return [];

    let products;
    try {
        products = await wcFetchJson('products', { include: ids.join(','), per_page: 100 });
    } catch (err) {
        console.error('[LupaEcoart] No se pudo actualizar el stock del carrito:', err);
        return [];
    }

    const limits = {};
    const managed = {};
    ids.forEach(id => {
        const p = products.find(x => x.id === id);
        limits[id] = p && (p.status === undefined || p.status === 'publish') ? wcStockLimit(p) : 0;
        managed[id] = !!(p && p.manage_stock && !p.backorders_allowed);
    });

    const left = { ...limits };
    const changes = [];
    const updated = [];
    cart.forEach(item => {
        const before = item.quantity || 1;
        const after = Math.min(before, left[item.id]);
        left[item.id] -= after;
        if (after !== before) {
            changes.push({ name: item.name, size: item.size, before, after, limit: limits[item.id], managed: managed[item.id] });
        }
        if (after > 0) updated.push({ ...item, quantity: after, maxQty: limits[item.id] });
    });

    saveCartToStorage(updated);
    return changes;
}

// Notificación visual reutilizable
function showCartNotification(message, type = 'ok') {
    const notif = document.createElement('div');
    notif.className = `fixed top-20 right-4 left-4 sm:left-auto ${type === 'warning' ? 'bg-neutral-900' : 'bg-primary-800'} text-white px-6 py-3 rounded-full shadow-xl z-50 text-sm font-semibold text-center`;
    notif.setAttribute('role', 'status');
    notif.textContent = message;
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), type === 'warning' ? 4000 : 2500);
}

// Buscadores (navbar desktop + drawer mobile): fuera del catálogo, Enter lleva
// a productos?q=... (en productos la búsqueda filtra en vivo desde js/productos.js)
function setupNavSearch() {
    if (document.getElementById('products-grid')) return;
    document.querySelectorAll('[data-search]').forEach(input => {
        input.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' || !input.value.trim()) return;
            e.preventDefault();
            location.href = `productos?q=${encodeURIComponent(input.value.trim())}`;
        });
    });
}

// Actualizar contadores apenas carga cualquier página que incluya este script
document.addEventListener('DOMContentLoaded', () => {
    setupMobileCartWidget();
    updateCartCounters();
    setupNavSearch();
});

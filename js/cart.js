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

// Añade un producto al carrito (o suma cantidad si ya existe con la misma medida).
// product = { id, name, price, image, size (opcional), quantity (opcional, default 1) }
function addToCart(product) {
    const cart = getCart();
    const size = product.size || null;
    const existing = cart.find(item => item.id === product.id && item.size === size);

    if (existing) {
        existing.quantity = (existing.quantity || 1) + (product.quantity || 1);
    } else {
        cart.push({
            id: product.id,
            name: product.name,
            price: product.price,
            image: product.image,
            size: size,
            quantity: product.quantity || 1
        });
    }

    saveCartToStorage(cart);
    showCartNotification(`${product.name}${size ? ` (${size})` : ''} añadido al carrito`);
}

// Notificación visual reutilizable
function showCartNotification(message) {
    const notif = document.createElement('div');
    notif.className = 'fixed top-20 right-4 bg-primary-800 text-white px-6 py-3 rounded-full shadow-xl z-50 text-sm font-semibold';
    notif.textContent = message;
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 2500);
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

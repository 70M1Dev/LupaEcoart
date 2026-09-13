// ==========================================
// ESTADO DEL CARRITO (usa el módulo compartido js/cart.js)
// ==========================================
let cart = getCart();
let appliedCoupon = JSON.parse(localStorage.getItem('coupon')) || null;

// Cupones válidos → porcentaje de descuento
const COUPONS = { ECOART10: 0.10, BIENVENIDO15: 0.15 };

// Envío gratis desde este monto (pesos uruguayos)
const FREE_SHIPPING_FROM = 3000;
const SHIPPING_COST = 250;

// ==========================================
// UTILIDADES
// ==========================================
function persistCart() {
    saveCartToStorage(cart);
}

function getSubtotal() {
    return cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
}

function getShipping(subtotal) {
    return subtotal >= FREE_SHIPPING_FROM ? 0 : SHIPPING_COST;
}

function getDiscount(subtotal) {
    return appliedCoupon && COUPONS[appliedCoupon] ? subtotal * COUPONS[appliedCoupon] : 0;
}

// ==========================================
// RENDERIZAR CARRITO
// ==========================================
function renderCart() {
    const emptyCart = document.getElementById('empty-cart');
    const cartContent = document.getElementById('cart-content');
    const cartItems = document.getElementById('cart-items');
    const subtitle = document.getElementById('cart-subtitle');

    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
    subtitle.textContent = `${totalItems} producto${totalItems !== 1 ? 's' : ''} en tu carrito`;

    if (cart.length === 0) {
        emptyCart.classList.remove('hidden');
        cartContent.classList.add('hidden');
        return;
    }

    emptyCart.classList.add('hidden');
    cartContent.classList.remove('hidden');

    cartItems.innerHTML = cart.map((item, index) => `
        <div class="bg-white rounded-2xl border border-primary-100 p-4 flex gap-4 mb-4">
            <img src="${item.image}" alt="${item.name}" class="w-24 h-24 md:w-32 md:h-32 object-cover rounded-xl bg-primary-50">

            <div class="flex-1">
                <div class="flex justify-between items-start gap-2">
                    <div>
                        <h3 class="font-semibold text-lg text-black">${item.name}</h3>
                        ${item.size ? `<p class="text-sm text-neutral-500">Medida: ${item.size}</p>` : ''}
                    </div>
                    <button onclick="removeItem(${index})" class="text-neutral-400 hover:text-accent transition" aria-label="Quitar">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3"/>
                        </svg>
                    </button>
                </div>

                <div class="flex items-center justify-between mt-4">
                    <div class="flex items-center gap-2">
                        <button onclick="updateQty(${index}, -1)" class="w-8 h-8 bg-primary-50 hover:bg-primary-100 text-primary-800 rounded-full font-bold transition">−</button>
                        <span class="w-10 text-center font-semibold">${item.quantity}</span>
                        <button onclick="updateQty(${index}, 1)" class="w-8 h-8 bg-primary-50 hover:bg-primary-100 text-primary-800 rounded-full font-bold transition">+</button>
                    </div>
                    <div class="text-right">
                        <p class="font-bold text-lg text-black">${wcPrice(item.price * item.quantity)}</p>
                        <p class="text-xs text-neutral-500">${wcPrice(item.price)} c/u</p>
                    </div>
                </div>
            </div>
        </div>
    `).join('');

    updateTotals();
}

// ==========================================
// ACCIONES DEL CARRITO
// ==========================================
function removeItem(index) {
    cart.splice(index, 1);
    persistCart();
    renderCart();
}

function updateQty(index, change) {
    cart[index].quantity += change;
    if (cart[index].quantity < 1) cart[index].quantity = 1;
    if (cart[index].quantity > 10) cart[index].quantity = 10;
    persistCart();
    renderCart();
}

function updateTotals() {
    const subtotal = getSubtotal();
    const shipping = getShipping(subtotal);
    const discount = getDiscount(subtotal);
    const total = subtotal + shipping - discount;

    document.getElementById('subtotal').textContent = wcPrice(subtotal);
    document.getElementById('shipping').textContent = shipping === 0 ? 'Gratis' : wcPrice(shipping);
    document.getElementById('shipping').className = `font-semibold ${shipping === 0 ? 'text-primary-600' : ''}`;
    document.getElementById('total').textContent = wcPrice(total);

    const discountRow = document.getElementById('discount-row');
    if (discount > 0) {
        discountRow.classList.remove('hidden');
        document.getElementById('discount').textContent = `-${wcPrice(discount)}`;
    } else {
        discountRow.classList.add('hidden');
    }
}

// ==========================================
// CUPONES
// ==========================================
document.getElementById('apply-coupon').addEventListener('click', () => {
    const code = document.getElementById('coupon-input').value.trim().toUpperCase();
    const msgEl = document.getElementById('coupon-message');

    if (COUPONS[code]) {
        appliedCoupon = code;
        msgEl.textContent = `Cupón "${code}" aplicado`;
        msgEl.className = 'text-sm mt-2 text-primary-600 font-medium';
    } else if (code === '') {
        msgEl.textContent = 'Ingresá un código';
        msgEl.className = 'text-sm mt-2 text-neutral-600';
    } else {
        msgEl.textContent = 'Cupón inválido';
        msgEl.className = 'text-sm mt-2 text-red-600';
        appliedCoupon = null;
    }
    // checkout.js lee el cupón desde localStorage
    localStorage.setItem('coupon', JSON.stringify(appliedCoupon));
    renderCart();
});

// ==========================================
// CHECKOUT
// ==========================================
document.getElementById('checkout-btn').addEventListener('click', () => {
    if (cart.length === 0) return;
    window.location.href = 'checkout';
});

// ==========================================
// DRAWER + NAVBAR (igual que otras páginas)
// ==========================================
const toggle = document.getElementById('menu-toggle');
const drawer = document.getElementById('drawer');
const overlay = document.getElementById('drawer-overlay');
const iconHamburger = document.getElementById('icon-hamburger');
const iconClose = document.getElementById('icon-close');

function openDrawer() {
    drawer.classList.remove('translate-x-full');
    overlay.classList.remove('hidden');
    setTimeout(() => overlay.classList.add('opacity-100'), 10);
    iconHamburger.classList.add('hidden');
    iconClose.classList.remove('hidden');
}

function closeDrawer() {
    drawer.classList.add('translate-x-full');
    overlay.classList.remove('opacity-100');
    setTimeout(() => overlay.classList.add('hidden'), 300);
    iconHamburger.classList.remove('hidden');
    iconClose.classList.add('hidden');
}

if (toggle) {
    toggle.addEventListener('click', () => {
        if (drawer.classList.contains('translate-x-full')) openDrawer();
        else closeDrawer();
    });
    overlay.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
}

const navbar = document.getElementById('navbar-scroll');
let lastScroll = 0;
window.addEventListener('scroll', () => {
    if (!navbar) return;
    const currentScroll = window.pageYOffset;
    if (currentScroll > lastScroll && currentScroll > 100) navbar.classList.add('-translate-y-full');
    else if (currentScroll < lastScroll) navbar.classList.remove('-translate-y-full');
    lastScroll = currentScroll;
});

// ==========================================
// INIT
// ==========================================
if (appliedCoupon) document.getElementById('coupon-input').value = appliedCoupon;
renderCart();
updateCartCounters();

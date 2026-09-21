import { wcPrice } from './config.js';
import {
    cartQuantityFor,
    getCart,
    refreshCartStock,
    saveCartToStorage,
    updateCartCounters
} from './cart.js';

// ==========================================
// ESTADO DEL CARRITO (usa el módulo compartido ./cart.js)
// ==========================================
let cart = getCart();
let appliedCoupon = JSON.parse(localStorage.getItem('coupon')) || null;

// Estimación de envío para el carrito. El valor final lo calcula WooCommerce
// en el checkout (zona Uruguay: $ 250, gratis desde $ 3.000).
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

// Maximo para una linea: stock del producto menos lo que ocupan sus otras medidas.
function maxQtyFor(index) {
    const item = cart[index];
    const limit = Number.isFinite(item.maxQty) ? item.maxQty : Infinity; // null = sin tope
    const others = cartQuantityFor(item.id, cart) - item.quantity;
    return Math.max(1, limit - others);
}

// Aviso persistente cuando el stock de WooCommerce obligo a cambiar el carrito.
function renderStockNotice(changes) {
    const old = document.getElementById('stock-notice');
    if (old) old.remove();
    if (!changes.length) return;

    const notice = document.createElement('div');
    notice.id = 'stock-notice';
    notice.setAttribute('role', 'status');
    notice.className = 'mt-4 bg-cream/60 border border-mustard/40 text-black text-sm rounded-2xl px-4 py-3 space-y-1';
    notice.innerHTML = changes.map(c => {
        const name = `${c.name}${c.size && c.size !== 'Única' ? ` (${c.size})` : ''}`;
        const p = document.createElement('p');
        p.textContent = c.after === 0
            ? `"${name}" se quedó sin stock y lo quitamos del carrito.`
            : `Ajustamos "${name}" a ${c.after} ${c.after === 1 ? 'unidad' : 'unidades'}: es lo que queda en stock.`;
        return p.outerHTML;
    }).join('');
    document.getElementById('cart-subtitle').insertAdjacentElement('afterend', notice);
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
                        <button onclick="updateQty(${index}, 1)" ${item.quantity >= maxQtyFor(index) ? 'disabled title="No hay más stock"' : ''} class="w-8 h-8 bg-primary-50 hover:bg-primary-100 text-primary-800 rounded-full font-bold transition disabled:opacity-40 disabled:cursor-not-allowed">+</button>
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
    const item = cart[index];
    item.quantity = Math.min(Math.max(1, item.quantity + change), maxQtyFor(index));
    persistCart();
    renderCart();
}

function updateTotals() {
    const subtotal = getSubtotal();
    const shipping = getShipping(subtotal);
    const total = subtotal + shipping;

    document.getElementById('subtotal').textContent = wcPrice(subtotal);
    document.getElementById('shipping').textContent = shipping === 0 ? 'Gratis' : wcPrice(shipping);
    document.getElementById('shipping').className = `font-semibold ${shipping === 0 ? 'text-primary-600' : ''}`;
    document.getElementById('total').textContent = wcPrice(total);

    // El descuento del cupón lo calcula WooCommerce en el checkout.
    document.getElementById('discount-row').classList.add('hidden');
}

// ==========================================
// CUPONES
// ==========================================
document.getElementById('apply-coupon').addEventListener('click', () => {
    const code = document.getElementById('coupon-input').value.trim().toUpperCase();
    const msgEl = document.getElementById('coupon-message');

    // Los cupones viven en WooCommerce: acá solo se guarda el código y el
    // checkout lo valida y muestra el descuento real.
    if (code === '') {
        appliedCoupon = null;
        msgEl.textContent = 'Ingresá un código';
        msgEl.className = 'text-sm mt-2 text-neutral-600';
    } else {
        appliedCoupon = code;
        msgEl.textContent = `Guardamos "${code}": el descuento se aplica al finalizar la compra.`;
        msgEl.className = 'text-sm mt-2 text-primary-600 font-medium';
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

// El drawer y el navbar viven ahora en ./ui.js y los inicializa el layout.

// ==========================================
// INIT
// ==========================================
// Quitar y sumar unidades se dispara con onclick desde el HTML que arma
// renderCart(), asi que las funciones tienen que estar en window.
window.removeItem = removeItem;
window.updateQty = updateQty;

if (appliedCoupon) document.getElementById('coupon-input').value = appliedCoupon;
renderCart();
updateCartCounters();

// Sincroniza con el stock actual de WooCommerce (el carrito puede tener días).
refreshCartStock().then(changes => {
    cart = getCart();
    renderStockNotice(changes);
    renderCart();
});

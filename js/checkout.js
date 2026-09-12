// ==========================================
// ESTADO
// ==========================================
let cart = JSON.parse(localStorage.getItem('cart')) || [];
let appliedCoupon = JSON.parse(localStorage.getItem('coupon')) || null;

// Deben coincidir con js/carrito.js
const COUPONS = { ECOART10: 0.10, BIENVENIDO15: 0.15 };
const FREE_SHIPPING_FROM = 3000;
const SHIPPING_COST = 250;

// ==========================================
// FUNCIONES DE TOTALES
// ==========================================
function getSubtotal() { return cart.reduce((sum, item) => sum + (item.price * item.quantity), 0); }
function getShipping(subtotal) { return subtotal >= FREE_SHIPPING_FROM ? 0 : SHIPPING_COST; }
function getDiscount(subtotal) {
    return appliedCoupon && COUPONS[appliedCoupon] ? subtotal * COUPONS[appliedCoupon] : 0;
}

// ==========================================
// RENDERIZAR RESUMEN
// ==========================================
function renderSummary() {
    const itemsEl = document.getElementById('checkout-items');

    itemsEl.innerHTML = cart.map(item => `
        <div class="flex gap-3">
            <img src="${item.image}" alt="${item.name}" class="w-16 h-16 object-cover rounded-xl bg-primary-50">
            <div class="flex-1 min-w-0">
                <p class="font-medium text-sm line-clamp-2 text-black">${item.name}</p>
                <p class="text-xs text-neutral-500">${item.size ? 'Medida: ' + item.size + ' · ' : ''}Cant: ${item.quantity}</p>
            </div>
            <p class="font-bold text-sm whitespace-nowrap">${wcPrice(item.price * item.quantity)}</p>
        </div>
    `).join('');

    const subtotal = getSubtotal();
    const shipping = getShipping(subtotal);
    const discount = getDiscount(subtotal);
    const total = subtotal + shipping - discount;

    document.getElementById('checkout-subtotal').textContent = wcPrice(subtotal);
    document.getElementById('checkout-shipping').textContent = shipping === 0 ? 'Gratis' : wcPrice(shipping);
    document.getElementById('checkout-total').textContent = wcPrice(total);

    const discountRow = document.getElementById('checkout-discount-row');
    if (discount > 0) {
        discountRow.classList.remove('hidden');
        document.getElementById('checkout-discount').textContent = `-${wcPrice(discount)}`;
    }
}

// ==========================================
// VALIDACIÓN Y ENVÍO
// ==========================================
document.getElementById('place-order-btn').addEventListener('click', (e) => {
    e.preventDefault();

    const requiredFields = ['email', 'phone', 'first-name', 'last-name', 'dni', 'address', 'zipcode', 'state', 'city'];
    let isValid = true;

    requiredFields.forEach(id => {
        const field = document.getElementById(id);
        if (!field.value.trim()) {
            field.classList.add('border-red-500');
            isValid = false;
        } else {
            field.classList.remove('border-red-500');
        }
    });

    if (!isValid) {
        alert('Por favor completá todos los campos obligatorios');
        return;
    }

    if (cart.length === 0) {
        alert('Tu carrito está vacío');
        window.location.href = 'productos.html';
        return;
    }

    // Acá se enviaría la orden a WooCommerce
    const orderData = {
        customer: {
            email: document.getElementById('email').value,
            phone: document.getElementById('phone').value,
            first_name: document.getElementById('first-name').value,
            last_name: document.getElementById('last-name').value,
            dni: document.getElementById('dni').value,
            address: document.getElementById('address').value,
            apartment: document.getElementById('apartment').value,
            city: document.getElementById('city').value,
            state: document.getElementById('state').value,
            zipcode: document.getElementById('zipcode').value,
        },
        payment: document.querySelector('input[name="payment"]:checked').value,
        items: cart,
        coupon: appliedCoupon,
        total: getSubtotal() + getShipping(getSubtotal()) - getDiscount(getSubtotal())
    };

    console.log('Orden a enviar:', orderData);

    // Simular envío
    const btn = document.getElementById('place-order-btn');
    btn.disabled = true;
    btn.textContent = 'Procesando...';

    setTimeout(() => {
        alert('¡Pedido confirmado! Te contactaremos pronto.');
        localStorage.removeItem('cart');
        localStorage.removeItem('coupon');
        window.location.href = 'index.html';
    }, 1500);
});

// ==========================================
// INIT
// ==========================================
renderSummary();

import { WC_CONFIG, wcPrice } from './config.js';
import { getCart, personalizationFiles, saveCartToStorage } from './cart.js';

// ==========================================
// CHECKOUT — pedidos reales en WooCommerce
// ==========================================
// Usa la Store API de WooCommerce a traves del Worker (PROXY_URL/store/…).
// WooCommerce arma el carrito con los productos del carrito local y calcula
// precios, stock, cupón y envío; despues crea el pedido. El navegador no
// decide ningun precio: solo muestra lo que devuelve WooCommerce.
// ==========================================

// Metodos de pago que sabemos mostrar. Mercado Pago "custom" (tarjeta dentro
// de la pagina) necesita campos propios del plugin, por eso no se ofrece aca:
// "basic" redirige a Mercado Pago y cubre tarjeta, debito y dinero en cuenta.
const PAYMENT_METHODS = {
    'woo-mercado-pago-basic': {
        label: 'Mercado Pago',
        text: 'Tarjeta de crédito, débito o dinero en cuenta. Te llevamos a Mercado Pago para pagar.',
        badge: 'Recomendado',
        button: 'Ir a pagar con Mercado Pago'
    },
    bacs: {
        label: 'Transferencia bancaria',
        text: 'Te enviamos por mail los datos de la cuenta. Preparamos el pedido cuando se acredita el pago.',
        button: 'Confirmar pedido'
    },
    cod: {
        label: 'Coordinar por WhatsApp',
        text: 'Hacés el pedido y coordinamos el pago y la entrega por WhatsApp.',
        button: 'Confirmar pedido'
    }
};

const REQUIRED_FIELDS = ['email', 'phone', 'first-name', 'last-name', 'dni', 'address', 'zipcode', 'state', 'city'];

const $ = id => document.getElementById(id);

const localCart = getCart();
let storeToken = null;
let storeCart = null;
let busy = false;

// ==========================================
// UTILIDADES
// ==========================================

function esc(text) {
    return String(text ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

// WooCommerce devuelve textos con entidades HTML (&quot;, &#8211;…)
function decodeHtml(text) {
    const el = document.createElement('textarea');
    el.innerHTML = String(text || '');
    return el.value;
}

// La Store API manda los montos como enteros en la unidad menor de la moneda.
function money(minor) {
    const unit = storeCart ? storeCart.totals.currency_minor_unit : 0;
    return wcPrice(Number(minor || 0) / 10 ** unit);
}

function readCoupon() {
    try { return JSON.parse(localStorage.getItem('coupon')) || null; } catch { return null; }
}

function saveCoupon(code) {
    try {
        if (code) localStorage.setItem('coupon', JSON.stringify(code));
        else localStorage.removeItem('coupon');
    } catch { /* storage bloqueado */ }
}

// ==========================================
// STORE API
// ==========================================

function storeErrorMessage(data, status) {
    const code = (data && data.code) || '';
    if (/out_of_stock/.test(code)) return 'No hay stock suficiente de uno de los productos.';
    if (code === 'woocommerce_rest_cart_coupon_error') return 'Ese cupón no existe o no se puede usar en esta compra.';
    if (/email/.test(code)) return 'Revisá el email: parece que no es válido.';
    if (code === 'woocommerce_rest_cart_empty') return 'Tu carrito está vacío.';
    if (code === 'woocommerce_rest_invalid_payment_method') return 'Elegí un método de pago.';
    if (code === 'rest_invalid_param' && data.data && data.data.params) {
        return `Revisá estos datos: ${Object.values(data.data.params).map(decodeHtml).join(' ')}`;
    }
    if (status === 403) return 'La tienda rechazó el pedido. Recargá la página y probá de nuevo.';
    const message = data && (data.message || data.error);
    return message ? decodeHtml(message) : 'No pudimos procesar el pedido. Probá de nuevo en unos minutos.';
}

async function storeFetch(path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (storeToken) headers['Cart-Token'] = storeToken;

    let res;
    try {
        res = await fetch(`${WC_CONFIG.PROXY_URL}/store/${path}`, {
            method: body === undefined ? 'GET' : 'POST',
            headers,
            body: body === undefined ? undefined : JSON.stringify(body)
        });
    } catch {
        throw Object.assign(new Error('No hay conexión con la tienda. Revisá internet y probá de nuevo.'), { status: 0 });
    }

    const token = res.headers.get('Cart-Token');
    if (token) storeToken = token;

    let data = null;
    try { data = await res.json(); } catch { /* sin cuerpo */ }

    if (!res.ok) {
        throw Object.assign(new Error(storeErrorMessage(data, res.status)), { status: res.status, code: data && data.code });
    }
    return data;
}

// El carrito local separa medidas; en WooCommerce el producto es uno solo.
function groupByProduct(items) {
    const groups = new Map();
    items.forEach(item => {
        const group = groups.get(item.id) || { id: item.id, name: item.name, quantity: 0 };
        group.quantity += item.quantity || 1;
        groups.set(item.id, group);
    });
    return [...groups.values()];
}

// ==========================================
// RENDER
// ==========================================

function showError(message) {
    const el = $('checkout-error');
    el.textContent = message;
    el.classList.toggle('hidden', !message);
    if (message) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderNotices(notices) {
    const box = $('checkout-notices');
    box.innerHTML = notices.map(n => `<p>${esc(n)}</p>`).join('');
    box.classList.toggle('hidden', notices.length === 0);
}

function sizesFor(productId) {
    return localCart
        .filter(item => item.id === productId && item.size && item.size !== 'Única')
        .map(item => `${item.size} ×${item.quantity}`);
}

function filesLabel(count) {
    if (!count) return '';
    return count === 1 ? ' · con 1 archivo' : ` · con ${count} archivos`;
}

function personalizationsFor(productId) {
    return localCart.filter(item => item.id === productId && item.personalization);
}

// Lo que el Worker guarda aparte para el panel (textos + ids de archivos).
function buildPersonalizations() {
    return localCart
        .filter(item => item.personalization)
        .map(item => ({
            product_id: item.id,
            name: item.name,
            size: item.size && item.size !== 'Única' ? item.size : '',
            quantity: item.quantity || 1,
            text: item.personalization.text,
            files: personalizationFiles(item.personalization).map(f => f.id).filter(Boolean)
        }));
}

function renderItems() {
    $('checkout-items').innerHTML = storeCart.items.map(item => {
        const image = item.images && item.images[0] ? (item.images[0].thumbnail || item.images[0].src) : '';
        const sizes = sizesFor(item.id);
        const custom = personalizationsFor(item.id);
        return `
            <div class="flex gap-3">
                <img src="${esc(image)}" alt="" class="w-16 h-16 object-cover rounded-xl bg-primary-50">
                <div class="flex-1 min-w-0">
                    <p class="font-medium text-sm line-clamp-2 text-black">${esc(decodeHtml(item.name))}</p>
                    <p class="text-xs text-neutral-500">${sizes.length ? `Medida: ${esc(sizes.join(', '))} · ` : ''}Cant: ${item.quantity}</p>
                    ${custom.map(c => `<p class="text-xs text-primary-800 mt-0.5 line-clamp-2">Personalización: ${esc(c.personalization.text)}${filesLabel(personalizationFiles(c.personalization).length)}</p>`).join('')}
                </div>
                <p class="font-bold text-sm whitespace-nowrap">${money(item.totals.line_subtotal)}</p>
            </div>`;
    }).join('');
}

function renderTotals() {
    const t = storeCart.totals;
    $('checkout-subtotal').textContent = money(t.total_items);

    const discount = Number(t.total_discount || 0);
    $('checkout-discount-row').classList.toggle('hidden', discount === 0);
    $('checkout-discount').textContent = `-${money(discount)}`;

    // El envío siempre se coordina con el cliente: no se calcula ni se cobra acá.
    $('checkout-total').textContent = money(t.total_price);
}

function availablePayments() {
    return (storeCart.payment_methods || []).filter(id => PAYMENT_METHODS[id]);
}

function renderPayments() {
    const box = $('payment-methods');
    const methods = availablePayments();
    const previous = (document.querySelector('input[name="payment"]:checked') || {}).value;

    if (!methods.length) {
        box.innerHTML = '<p class="text-sm text-red-700">No hay métodos de pago disponibles en este momento.</p>';
        return;
    }

    // Mercado Pago primero si esta activo
    methods.sort((a, b) => Object.keys(PAYMENT_METHODS).indexOf(a) - Object.keys(PAYMENT_METHODS).indexOf(b));
    const selected = methods.includes(previous) ? previous : methods[0];

    box.innerHTML = methods.map(id => {
        const m = PAYMENT_METHODS[id];
        return `
            <label class="flex items-start gap-3 p-4 border-2 rounded-2xl cursor-pointer hover:border-primary-800 transition ${id === selected ? 'border-primary-800' : 'border-primary-100'}">
                <input type="radio" name="payment" value="${id}" ${id === selected ? 'checked' : ''} class="mt-1 accent-primary-800">
                <div class="flex-1">
                    <div class="flex items-center gap-2">
                        <span class="font-semibold">${esc(m.label)}</span>
                        ${m.badge ? `<span class="bg-primary-800 text-white text-xs px-2 py-0.5 rounded-full">${esc(m.badge)}</span>` : ''}
                    </div>
                    <p class="text-sm text-neutral-600 mt-1">${esc(m.text)}</p>
                </div>
            </label>`;
    }).join('');
    updatePlaceButton();
}

function renderCoupon() {
    const applied = storeCart.coupons && storeCart.coupons[0];
    const input = $('checkout-coupon');
    const button = $('checkout-coupon-btn');
    if (applied) {
        input.value = applied.code.toUpperCase();
        input.disabled = true;
        button.textContent = 'Quitar';
    } else {
        input.disabled = false;
        button.textContent = 'Aplicar';
    }
}

function couponMessage(text, type) {
    const el = $('checkout-coupon-message');
    el.textContent = text;
    el.className = `text-xs mt-2 ${type === 'error' ? 'text-red-600' : 'text-primary-600 font-medium'}`;
    el.classList.toggle('hidden', !text);
}

function selectedPayment() {
    return (document.querySelector('input[name="payment"]:checked') || {}).value;
}

function updatePlaceButton() {
    const button = $('place-order-btn');
    const method = PAYMENT_METHODS[selectedPayment()];
    button.textContent = busy ? 'Procesando…' : (method ? method.button : 'Confirmar pedido');
    button.disabled = busy || !storeCart || !storeCart.items.length || !availablePayments().length;
}

function renderAll() {
    renderItems();
    renderCoupon();
    renderTotals();
    renderPayments();
}

function renderEmpty() {
    $('checkout-items').innerHTML = `
        <div class="text-center py-6">
            <p class="text-sm text-neutral-600 mb-3">Tu carrito está vacío.</p>
            <a href="productos" class="text-sm font-semibold text-primary-700 underline">Ver el catálogo</a>
        </div>`;
    $('payment-methods').innerHTML = '<p class="text-sm text-neutral-500">Agregá productos para elegir cómo pagar.</p>';
    updatePlaceButton();
}

// ==========================================
// ACCIONES
// ==========================================

async function withBusy(task) {
    if (busy) return;
    busy = true;
    updatePlaceButton();
    try {
        await task();
    } catch (err) {
        showError(err.message);
    } finally {
        busy = false;
        updatePlaceButton();
    }
}

async function initCheckout() {
    if (!localCart.length) {
        renderEmpty();
        return;
    }
    if (!WC_CONFIG.PROXY_URL) {
        showError('La tienda todavía no está conectada. Volvé a intentar más tarde.');
        return;
    }

    await withBusy(async () => {
        await storeFetch('cart'); // sesion de carrito nueva

        const notices = [];
        for (const item of groupByProduct(localCart)) {
            try {
                storeCart = await storeFetch('cart/add-item', { id: item.id, quantity: item.quantity });
            } catch (err) {
                notices.push(`"${item.name}": ${err.message}`);
            }
        }
        if (!storeCart || !storeCart.items.length) {
            storeCart = null;
            renderNotices(notices);
            renderEmpty();
            throw new Error('Ninguno de los productos del carrito se puede comprar ahora. Revisá el carrito.');
        }

        const coupon = readCoupon();
        if (coupon) {
            try {
                storeCart = await storeFetch('cart/apply-coupon', { code: coupon });
                couponMessage(`Cupón ${coupon} aplicado.`);
            } catch (err) {
                saveCoupon(null);
                couponMessage(`${coupon}: ${err.message}`, 'error');
            }
        }

        renderNotices(notices);
        renderAll();
    });
}

async function onCouponClick() {
    if (!storeCart) return;
    const applied = storeCart.coupons && storeCart.coupons[0];
    const code = $('checkout-coupon').value.trim();

    await withBusy(async () => {
        showError('');
        if (applied) {
            storeCart = await storeFetch('cart/remove-coupon', { code: applied.code });
            saveCoupon(null);
            $('checkout-coupon').value = '';
            couponMessage('');
        } else {
            if (!code) {
                couponMessage('Escribí el código del cupón.', 'error');
                return;
            }
            try {
                storeCart = await storeFetch('cart/apply-coupon', { code });
                saveCoupon(code.toUpperCase());
                couponMessage(`Cupón ${code.toUpperCase()} aplicado.`);
            } catch (err) {
                couponMessage(err.message, 'error');
                return;
            }
        }
        renderAll();
    });
}

function validateForm() {
    let firstInvalid = null;
    REQUIRED_FIELDS.forEach(id => {
        const field = $(id);
        const empty = !field.value.trim();
        const badEmail = id === 'email' && !empty && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(field.value.trim());
        const invalid = empty || badEmail;
        field.classList.toggle('border-red-500', invalid);
        if (invalid && !firstInvalid) firstInvalid = field;
    });
    if (firstInvalid) {
        firstInvalid.focus();
        return firstInvalid.id === 'email' && firstInvalid.value.trim()
            ? 'Revisá el email: parece que no es válido.'
            : 'Completá los campos marcados en rojo.';
    }
    if (!selectedPayment()) return 'Elegí un método de pago.';
    return null;
}

function buildCustomerNote() {
    const lines = [];
    const notes = $('notes').value.trim();
    if (notes) lines.push(notes);
    lines.push(`Cédula/RUT: ${$('dni').value.trim()}`);
    const sizes = localCart
        .filter(item => item.size && item.size !== 'Única')
        .map(item => `- ${item.name}: medida ${item.size} ×${item.quantity}`);
    if (sizes.length) lines.push(`Medidas:\n${sizes.join('\n')}`);
    // Tambien en la nota: asi el texto queda en WooCommerce y en los mails.
    const custom = localCart
        .filter(item => item.personalization)
        .map(item => `- ${item.name}${item.size && item.size !== 'Única' ? ` (${item.size})` : ''} ×${item.quantity}: ${item.personalization.text}${personalizationFiles(item.personalization).length ? ` [archivos: ${personalizationFiles(item.personalization).map(f => f.name).join(', ')}]` : ''}`);
    if (custom.length) lines.push(`Personalización:\n${custom.join('\n')}`);
    return lines.join('\n\n');
}

async function onPlaceOrder(e) {
    e.preventDefault();
    showError('');
    if (!storeCart) return;

    const invalid = validateForm();
    if (invalid) {
        showError(invalid);
        return;
    }

    const address = {
        first_name: $('first-name').value.trim(),
        last_name: $('last-name').value.trim(),
        address_1: $('address').value.trim(),
        address_2: $('apartment').value.trim(),
        city: $('city').value.trim(),
        state: $('state').value,
        postcode: $('zipcode').value.trim(),
        country: 'UY',
        phone: $('phone').value.trim()
    };
    const email = $('email').value.trim();
    const method = selectedPayment();
    const totals = { ...storeCart.totals };

    await withBusy(async () => {
        const result = await storeFetch('checkout', {
            billing_address: { ...address, email },
            shipping_address: address,
            customer_note: buildCustomerNote(),
            payment_method: method,
            payment_data: [],
            // Lo separa el Worker antes de mandar el pedido a WooCommerce.
            lupa_personalizations: buildPersonalizations()
        });

        const payment = result.payment_result || {};
        if (payment.payment_status === 'failure' || payment.payment_status === 'error') {
            const detail = (payment.payment_details || []).map(d => d.value).join(' ');
            throw new Error(detail ? decodeHtml(detail) : 'El pago no se pudo iniciar. Probá con otro método.');
        }

        // El pedido ya existe en WooCommerce: vaciamos el carrito local.
        saveCartToStorage([]);
        saveCoupon(null);

        // Mercado Pago devuelve la URL de pago; transferencia y WhatsApp
        // devuelven la página de "pedido recibido" de WordPress, que no usamos.
        if (payment.redirect_url && !/order-received/.test(payment.redirect_url)) {
            window.location.href = payment.redirect_url;
            return;
        }
        showSuccess(result, method, email, totals);
    });
}

// Botón que abre WhatsApp de la tienda con el mensaje ya escrito.
// Sin WHATSAPP_NUMBER configurado no se muestra.
function whatsappButton(label, message) {
    if (!WC_CONFIG.WHATSAPP_NUMBER) return '';
    return `
        <a href="https://wa.me/${esc(WC_CONFIG.WHATSAPP_NUMBER)}?text=${encodeURIComponent(message)}" target="_blank" rel="noopener"
           class="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-6 py-3 rounded-full bg-[#1FAF38] hover:bg-[#178a2c] text-white font-semibold transition mb-3">
            ${esc(label)}
        </a>`;
}

function showSuccess(result, method, email, totals) {
    const number = result.order_number || result.order_id;
    const unit = totals.currency_minor_unit;
    const total = wcPrice(Number(totals.total_price) / 10 ** unit);

    let instructions;
    let action = '';
    if (method === 'bacs') {
        instructions = `Te enviamos un mail a ${email} con los datos de la cuenta para transferir ${total}. Cuando transfieras, mandanos el comprobante por WhatsApp y preparamos tu pedido apenas se acredite.`;
        action = whatsappButton('Enviar comprobante por WhatsApp',
            `¡Hola! Hice el pedido #${number} en Lupa Ecoart por ${total}. Te mando el comprobante de la transferencia.`);
    } else if (method === 'cod') {
        instructions = 'Te vamos a escribir por WhatsApp para coordinar el pago y la entrega.';
        action = whatsappButton('Escribinos por WhatsApp', `¡Hola! Hice el pedido #${number} en Lupa Ecoart.`);
    } else {
        instructions = `Te enviamos la confirmación a ${email}.`;
    }

    $('checkout-grid').classList.add('hidden');
    $('checkout-title').textContent = '¡Gracias por tu compra!';
    const box = $('order-success');
    box.innerHTML = `
        <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-primary-100 text-primary-800 flex items-center justify-center">
            <svg class="w-8 h-8" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
        </div>
        <h2 class="text-2xl font-semibold mb-1">Pedido #${esc(number)} recibido</h2>
        <p class="text-neutral-600 mb-1">Total: <span class="font-semibold text-black">${esc(total)}</span></p>
        <p class="text-neutral-600 mb-6">${esc(PAYMENT_METHODS[method] ? PAYMENT_METHODS[method].label : '')}</p>
        <p class="text-neutral-700 mb-6">${esc(instructions)}</p>
        ${action}
        <div><a href="./" class="inline-block text-primary-700 font-semibold underline">Volver a la tienda</a></div>`;
    box.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ==========================================
// INIT
// ==========================================
$('payment-methods').addEventListener('change', () => { renderPayments(); });
$('checkout-coupon-btn').addEventListener('click', onCouponClick);
$('place-order-btn').addEventListener('click', onPlaceOrder);
REQUIRED_FIELDS.forEach(id => $(id).addEventListener('input', () => $(id).classList.remove('border-red-500')));

initCheckout();

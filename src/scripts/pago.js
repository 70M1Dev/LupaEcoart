import { WC_CONFIG } from './config.js';
import { clearPendingPayment, getCart, readPendingPayment, saveCartToStorage } from './cart.js';

// ==========================================
// PAGO — vuelta de Mercado Pago
// ==========================================
// Mercado Pago trae al cliente a esta página al terminar o abandonar el pago
// (las tres "URL de retorno" del plugin apuntan acá) y agrega el resultado en
// la URL: ?status=approved|pending|in_process|rejected|null&external_reference=…
//
// Es solo informativo: el estado real del pedido lo cambia Mercado Pago en
// WooCommerce por su cuenta (webhook), no esta página.
// ==========================================

const params = new URLSearchParams(location.search);
const pending = readPendingPayment();

function esc(text) {
    return String(text ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

// approved → ok · pending / in_process → pendiente · el resto → no se cobró.
// Sin ?status no venimos de Mercado Pago.
function paymentResult() {
    const status = params.get('status') || params.get('collection_status');
    if (!status) return 'none';
    if (status === 'approved') return 'approved';
    if (status === 'pending' || status === 'in_process' || status === 'authorized') return 'pending';
    return 'failed';
}

// external_reference es el prefijo de la tienda + el número de pedido.
function orderNumber() {
    const match = (params.get('external_reference') || '').match(/(\d+)$/);
    if (match) return match[1];
    return pending && pending.number ? String(pending.number).replace(/\D/g, '') : '';
}

const ICONS = {
    approved: '<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/>',
    pending: '<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"/>',
    failed: '<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"/>'
};

function whatsappButton(label, message) {
    if (!WC_CONFIG.WHATSAPP_NUMBER) return '';
    return `
        <a href="https://wa.me/${esc(WC_CONFIG.WHATSAPP_NUMBER)}?text=${encodeURIComponent(message)}" target="_blank" rel="noopener"
           class="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-6 py-3 rounded-full bg-[#1FAF38] hover:bg-[#178a2c] text-white font-semibold transition mb-3">
            ${esc(label)}
        </a>`;
}

function render() {
    const result = paymentResult();
    const number = orderNumber();
    const order = number ? `pedido #${number}` : 'pedido';
    const box = document.getElementById('payment-result');

    if (result === 'none') {
        box.innerHTML = `
            <h2 class="text-2xl font-semibold mb-2">No hay ningún pago para mostrar</h2>
            <p class="text-neutral-600 mb-6">Si hiciste un pedido, te enviamos el detalle por mail.</p>
            <a href="./" class="inline-block text-primary-700 font-semibold underline">Volver a la tienda</a>`;
        return;
    }

    let title;
    let text;
    let actions;
    if (result === 'approved') {
        clearPendingPayment();
        document.getElementById('payment-title').textContent = '¡Gracias por tu compra!';
        title = 'Pago aprobado';
        text = `Recibimos el pago de tu ${order}. Te va a llegar la confirmación por mail y te escribimos para coordinar el envío.`;
        actions = whatsappButton('Escribinos por WhatsApp', `¡Hola! Pagué el ${order} en Lupa Ecoart con Mercado Pago.`);
    } else if (result === 'pending') {
        clearPendingPayment();
        title = 'Pago pendiente';
        text = `Mercado Pago todavía no acreditó el pago de tu ${order}. Si elegiste pagar en Abitab o Redpagos, hacelo con los datos que te dio Mercado Pago. Preparamos el pedido apenas se acredite.`;
        actions = whatsappButton('Escribinos por WhatsApp', `¡Hola! Hice el ${order} en Lupa Ecoart y el pago quedó pendiente.`);
    } else {
        title = 'El pago no se completó';
        text = `Mercado Pago no cobró tu ${order}, así que quedó sin pagar. Podés intentarlo de nuevo o elegir otra forma de pago.`;
        const primary = 'inline-flex items-center justify-center w-full sm:w-auto px-6 py-3 rounded-full bg-primary-700 hover:bg-primary-800 text-white font-semibold transition mb-3';
        const secondary = 'inline-flex items-center justify-center w-full sm:w-auto px-6 py-3 rounded-full bg-primary-50 hover:bg-primary-100 text-primary-800 font-semibold transition mb-3';
        const canRetry = pending && /^https:\/\//.test(pending.payUrl || '');
        const canRestore = pending && Array.isArray(pending.cart) && pending.cart.length;
        actions = `
            ${canRetry ? `<a href="${esc(pending.payUrl)}" class="${primary}">Reintentar con Mercado Pago</a>` : ''}
            ${canRestore ? `<button id="other-method" type="button" class="${canRetry ? secondary : primary}">Elegir otra forma de pago</button>` : ''}
            ${whatsappButton('Escribinos por WhatsApp', `¡Hola! Quise pagar el ${order} en Lupa Ecoart con Mercado Pago y no pude.`)}`;
    }

    box.innerHTML = `
        <div class="w-16 h-16 mx-auto mb-4 rounded-full ${result === 'failed' ? 'bg-red-50 text-red-700' : 'bg-primary-100 text-primary-800'} flex items-center justify-center">
            <svg class="w-8 h-8" fill="none" stroke="currentColor" stroke-width="${result === 'approved' ? 2.5 : 1.8}" viewBox="0 0 24 24">${ICONS[result]}</svg>
        </div>
        <h2 class="text-2xl font-semibold mb-1">${esc(title)}</h2>
        <p class="text-neutral-600 mb-6">Mercado Pago${number ? ` · Pedido #${esc(number)}` : ''}</p>
        <p class="text-neutral-700 mb-6">${esc(text)}</p>
        <div class="flex flex-col sm:flex-row sm:flex-wrap sm:justify-center sm:gap-x-3">${actions}</div>
        <div><a href="./" class="inline-block text-primary-700 font-semibold underline">Volver a la tienda</a></div>`;

    // Otra forma de pago = pedido nuevo: devolvemos el carrito y al checkout.
    const other = document.getElementById('other-method');
    if (other) {
        other.addEventListener('click', () => {
            if (!getCart().length) {
                saveCartToStorage(pending.cart);
                try {
                    if (pending.coupon) localStorage.setItem('coupon', JSON.stringify(pending.coupon));
                } catch { /* storage bloqueado */ }
            }
            clearPendingPayment();
            location.href = 'checkout';
        });
    }
}

render();

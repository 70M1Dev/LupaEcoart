import { WC_CONFIG, wcCategoryName, wcFetchJson, wcIsPersonalizable, wcPrice, wcRenderError, wcStockLimit } from './config.js';
import { addToCart, cartQuantityFor } from './cart.js';

// ==========================================
// DATOS: se cargan desde WooCommerce en loadProduct()
// ==========================================

// Convierte un producto de WooCommerce al formato que usa esta página
function mapWCProductDetail(p) {
    const price = parseFloat(p.price || p.regular_price || 0);
    const regular = parseFloat(p.regular_price || 0);
    const onSale = p.on_sale && regular > price;

    let badge = null;
    if (onSale) {
        const pct = Math.round(((regular - price) / regular) * 100);
        badge = `-${pct}%`;
    } else {
        const created = new Date(p.date_created);
        const days = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
        if (days <= 14) badge = 'NUEVO';
    }

    // Buscamos un atributo de medida/tamaño entre los atributos del producto
    const sizeAttr = (p.attributes || []).find(a =>
        /medida|tama[ñn]o|talle|size/i.test(a.name)
    );

    return {
        id: p.id,
        name: p.name,
        price: price,
        originalPrice: onSale ? regular : null,
        category: p.categories && p.categories.length ? p.categories[0].slug : '',
        // La descripción de WooCommerce viene con HTML (párrafos, negritas, etc.)
        description: p.description || p.short_description || '',
        images: p.images && p.images.length
            ? p.images.map(img => img.src)
            : ['https://placehold.co/600x700/E6EBB1/4A501C?text=Sin+imagen'],
        sizes: sizeAttr ? sizeAttr.options : [],
        // Unidades que se pueden comprar (0 = agotado) y stock real si se controla
        stockLimit: wcStockLimit(p),
        stockQuantity: p.manage_stock && !p.backorders_allowed ? p.stock_quantity : null,
        badge: badge,
        personalizable: wcIsPersonalizable(p),
        relatedIds: p.related_ids || []
    };
}

async function fetchProductById(id) {
    return mapWCProductDetail(await wcFetchJson(`products/${id}`));
}

async function fetchRelatedProducts(ids) {
    if (!ids || !ids.length) return [];
    // Traemos hasta 4 relacionados en paralelo
    const selected = ids.slice(0, 4);
    try {
        const results = await Promise.all(
            selected.map(id => fetchProductById(id))
        );
        return results;
    } catch (err) {
        console.error('Error trayendo relacionados:', err);
        return [];
    }
}

// ==========================================
// ESTADO
// ==========================================
let currentProduct = null;
let currentImageIndex = 0;
let selectedSize = null;
let quantity = 1;

// Clases del botón de medida seleccionado
const SIZE_ACTIVE = ['border-primary-800', 'bg-primary-800', 'text-white'];

// ==========================================
// UTILIDADES
// ==========================================
function getURLParam(param) {
    return new URLSearchParams(window.location.search).get(param);
}

function getCategoryName(cat) {
    return wcCategoryName(cat);
}

// ==========================================
// CARGAR PRODUCTO
// ==========================================
async function loadProduct() {
    const id = parseInt(getURLParam('id')) || 1;

    try {
        currentProduct = await fetchProductById(id);
    } catch (err) {
        // Sin producto no hay nada que renderizar: mostramos el estado de error
        // en lugar de una ficha vacía con precio $0.
        wcRenderError('product-detail', err);
        return;
    }

    // Actualizar info básica
    document.title = `${currentProduct.name} - Lupa Ecoart`;
    document.getElementById('product-name').textContent = currentProduct.name;
    document.getElementById('product-category').textContent = getCategoryName(currentProduct.category);
    document.getElementById('breadcrumb-category').textContent = getCategoryName(currentProduct.category);
    document.getElementById('product-price').textContent = wcPrice(currentProduct.price);
    document.getElementById('product-installment').textContent = wcPrice(currentProduct.price / 3);
    // La descripción de WooCommerce trae HTML (párrafos, etc.)
    document.getElementById('product-description').innerHTML = currentProduct.description;

    // Precio original y descuento
    if (currentProduct.originalPrice) {
        document.getElementById('product-original-price').textContent = wcPrice(currentProduct.originalPrice);
        document.getElementById('product-original-price').classList.remove('hidden');
        const discount = Math.round((1 - currentProduct.price / currentProduct.originalPrice) * 100);
        document.getElementById('product-discount').textContent = `-${discount}%`;
        document.getElementById('product-discount').classList.remove('hidden');
    }

    // Badge
    if (currentProduct.badge) {
        const badgeEl = document.getElementById('product-badge');
        badgeEl.textContent = currentProduct.badge;
        if (!currentProduct.badge.includes('-')) {
            badgeEl.classList.remove('bg-accent');
            badgeEl.classList.add('bg-teal');
        }
        badgeEl.classList.remove('hidden');
    }

    // Cargar galería
    renderGallery();

    // Cargar medidas
    renderSizes();

    // Personalización (solo si el producto está marcado en el panel)
    document.getElementById('personalization').classList.toggle('hidden', !currentProduct.personalizable);

    // Stock y tope de cantidad
    renderStock();

    // Cargar productos relacionados
    renderRelated();
}

// ==========================================
// GALERÍA
// ==========================================
function renderGallery() {
    const track = document.getElementById('gallery-track');
    const dots = document.getElementById('gallery-dots');

    // Imágenes principales
    track.innerHTML = currentProduct.images.map(img => `
        <img src="${img}" alt="${currentProduct.name}" class="w-full shrink-0 object-cover" style="aspect-ratio: 6/7;">
    `).join('');

    // Puntos indicadores (ocultos si hay una sola imagen)
    if (currentProduct.images.length > 1) {
        dots.innerHTML = currentProduct.images.map((_, i) => `
            <button class="gallery-dot w-2 h-2 rounded-full transition ${i === 0 ? 'bg-white w-6' : 'bg-white/50'}" data-index="${i}"></button>
        `).join('');
        dots.classList.remove('hidden');
    } else {
        dots.innerHTML = '';
        dots.classList.add('hidden');
    }

    document.querySelectorAll('.gallery-dot').forEach(dot => {
        dot.addEventListener('click', () => goToImage(parseInt(dot.dataset.index)));
    });

    // Posicionar en la primera imagen y recalcular ancho real
    currentImageIndex = 0;
    goToImage(0);
}

function goToImage(index) {
    currentImageIndex = index;
    const track = document.getElementById('gallery-track');

    // Movemos por porcentaje: cada imagen ocupa el 100% del contenedor
    track.style.transform = `translateX(-${index * 100}%)`;

    // Actualizar dots
    document.querySelectorAll('.gallery-dot').forEach((dot, i) => {
        if (i === index) {
            dot.classList.add('bg-white', 'w-6');
            dot.classList.remove('bg-white/50');
        } else {
            dot.classList.remove('bg-white', 'w-6');
            dot.classList.add('bg-white/50');
        }
    });
}

// ==========================================
// MEDIDAS
// ==========================================
function renderSizes() {
    const selector = document.getElementById('size-selector');
    const sizeSection = selector.closest('div.mb-6');

    if (!currentProduct.sizes || currentProduct.sizes.length === 0) {
        // Este producto no tiene atributo de medida en WooCommerce: ocultamos la sección
        if (sizeSection) sizeSection.classList.add('hidden');
        selectedSize = 'Única';
        return;
    }
    if (sizeSection) sizeSection.classList.remove('hidden');

    selector.innerHTML = currentProduct.sizes.map(size => `
        <button class="size-btn py-3 border-2 border-primary-100 rounded-xl font-medium hover:border-primary-800 transition" data-size="${size}">
            ${size}
        </button>
    `).join('');

    document.querySelectorAll('.size-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.size-btn').forEach(b => b.classList.remove(...SIZE_ACTIVE));
            btn.classList.add(...SIZE_ACTIVE);
            selectedSize = btn.dataset.size;
            document.getElementById('size-error').classList.add('hidden');
        });
    });
}

// ==========================================
// STOCK Y CANTIDAD
// ==========================================
// El tope es el stock de WooCommerce menos lo que ya esta en el carrito.

function availableToAdd() {
    if (!currentProduct) return 0;
    return Math.max(0, currentProduct.stockLimit - cartQuantityFor(currentProduct.id));
}

function clampQuantityInput() {
    const input = document.getElementById('quantity');
    const max = Math.max(1, availableToAdd());
    // Sin inventario en WooCommerce no hay tope (Infinity no es un "max" valido)
    if (Number.isFinite(max)) input.max = max;
    else input.removeAttribute('max');
    input.value = Math.min(Math.max(1, parseInt(input.value, 10) || 1), max);
}

function renderStock() {
    if (!currentProduct) return;
    const info = document.getElementById('stock-info');
    const { stockLimit, stockQuantity } = currentProduct;
    const inCart = cartQuantityFor(currentProduct.id);
    const available = availableToAdd();

    let text;
    let tone = 'bg-primary-50 text-primary-800';
    if (stockLimit === 0) {
        text = 'Sin stock';
        tone = 'bg-red-50 text-red-700';
    } else if (stockQuantity !== null) {
        text = `Stock disponible: ${stockQuantity} ${stockQuantity === 1 ? 'unidad' : 'unidades'}`;
        if (stockQuantity <= 3) tone = 'bg-accent/20 text-black';
    } else {
        // WooCommerce no lleva la cuenta de este producto: no hay numero que mostrar
        text = 'Stock disponible';
    }
    if (stockLimit > 0 && inCart) {
        text += available === 0 ? ' · ya están todas en tu carrito' : ` · ${inCart} en tu carrito`;
    }

    info.textContent = text;
    info.className = `inline-flex items-center text-sm font-semibold px-3 py-1.5 rounded-full ${tone}`;

    const blocked = available === 0;
    ['qty-minus', 'qty-plus', 'quantity', 'add-to-cart-btn'].forEach(id => {
        document.getElementById(id).disabled = blocked;
    });
    // "Comprar ahora" sigue activo si ya hay unidades en el carrito: lleva al carrito.
    document.getElementById('buy-now-btn').disabled = blocked && inCart === 0;

    clampQuantityInput();
}

document.getElementById('qty-minus').addEventListener('click', () => {
    const input = document.getElementById('quantity');
    input.value = Math.max(1, (parseInt(input.value, 10) || 1) - 1);
});

document.getElementById('qty-plus').addEventListener('click', () => {
    const input = document.getElementById('quantity');
    const next = (parseInt(input.value, 10) || 1) + 1;
    if (next <= availableToAdd()) input.value = next;
});

document.getElementById('quantity').addEventListener('change', clampQuantityInput);

// Si el carrito cambia en otra pestaña, recalculamos lo disponible
window.addEventListener('storage', e => {
    if (e.key === 'cart') renderStock();
});

// ==========================================
// GALERÍA - NAVEGACIÓN
// ==========================================
document.getElementById('prev-btn').addEventListener('click', () => {
    const newIndex = currentImageIndex === 0 ? currentProduct.images.length - 1 : currentImageIndex - 1;
    goToImage(newIndex);
});

document.getElementById('next-btn').addEventListener('click', () => {
    const newIndex = currentImageIndex === currentProduct.images.length - 1 ? 0 : currentImageIndex + 1;
    goToImage(newIndex);
});

// Swipe en mobile
let touchStartX = 0;
let touchEndX = 0;
const galleryMain = document.getElementById('gallery-main');

galleryMain.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
});

galleryMain.addEventListener('touchend', (e) => {
    touchEndX = e.changedTouches[0].screenX;
    handleSwipe();
});

function handleSwipe() {
    const diff = touchStartX - touchEndX;
    if (Math.abs(diff) < 50) return; // Ignorar swipes muy cortos

    if (diff > 0 && currentImageIndex < currentProduct.images.length - 1) {
        // Swipe izquierda → siguiente
        goToImage(currentImageIndex + 1);
    } else if (diff < 0 && currentImageIndex > 0) {
        // Swipe derecha → anterior
        goToImage(currentImageIndex - 1);
    }
}

// ==========================================
// BOTONES DE ACCIÓN
// ==========================================
function requireSize() {
    if (currentProduct.sizes && currentProduct.sizes.length > 0 && !selectedSize) {
        document.getElementById('size-error').classList.remove('hidden');
        document.getElementById('size-selector').scrollIntoView({ behavior: 'smooth', block: 'center' });
        return false;
    }
    return true;
}

// ==========================================
// PERSONALIZACIÓN
// ==========================================
// El archivo se sube al Worker recien al agregar al carrito; el carrito guarda
// solo su id. El Worker lo ata al pedido cuando se confirma la compra.
const MAX_PERSONALIZATION_BYTES = 10 * 1024 * 1024;
let addingToCart = false;

function personalizationError(message) {
    const el = document.getElementById('personalization-error');
    el.textContent = message || '';
    el.classList.toggle('hidden', !message);
    if (message) document.getElementById('personalization').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function selectedPersonalizationFile() {
    return document.getElementById('personalization-file').files[0] || null;
}

function renderPersonalizationFile() {
    const file = selectedPersonalizationFile();
    document.getElementById('personalization-file-label').textContent = file ? file.name : 'Subir archivo (opcional)';
    document.getElementById('personalization-file-clear').classList.toggle('hidden', !file);
    personalizationError(file && file.size > MAX_PERSONALIZATION_BYTES
        ? 'El archivo pesa más de 10 MB. Probá con uno más liviano.'
        : '');
}

function resetPersonalization() {
    document.getElementById('personalization-text').value = '';
    document.getElementById('personalization-file').value = '';
    renderPersonalizationFile();
}

// Devuelve { text, file } listo para subir, o null si falta algo (y lo avisa).
function readPersonalization() {
    const text = document.getElementById('personalization-text').value.trim();
    const file = selectedPersonalizationFile();
    if (!text) {
        personalizationError('Contanos cómo querés la personalización antes de agregarlo al carrito.');
        document.getElementById('personalization-text').focus();
        return null;
    }
    if (file && file.size > MAX_PERSONALIZATION_BYTES) {
        personalizationError('El archivo pesa más de 10 MB. Probá con uno más liviano.');
        return null;
    }
    personalizationError('');
    return { text, file };
}

async function uploadPersonalizationFile(file) {
    // Sin Worker (boceto local) no hay donde subirlo: queda solo el nombre.
    if (!WC_CONFIG.PROXY_URL) return { id: null, name: file.name };

    let res;
    try {
        res = await fetch(`${WC_CONFIG.PROXY_URL}/custom/upload`, {
            method: 'POST',
            headers: {
                'Content-Type': file.type || 'application/octet-stream',
                'X-File-Name': encodeURIComponent(file.name)
            },
            body: file
        });
    } catch {
        throw new Error('No pudimos subir el archivo. Revisá tu conexión y probá de nuevo.');
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.error) || 'No pudimos subir el archivo. Probá de nuevo.');
    return { id: data.id, name: data.name };
}

function setAddingToCart(busy) {
    addingToCart = busy;
    const button = document.getElementById('add-to-cart-btn');
    if (!button.dataset.label) button.dataset.label = button.innerHTML;
    button.innerHTML = busy ? 'Subiendo archivo…' : button.dataset.label;
    button.disabled = busy;
    document.getElementById('buy-now-btn').disabled = busy;
    if (!busy) renderStock();
}

document.getElementById('personalization-file').addEventListener('change', renderPersonalizationFile);
document.getElementById('personalization-file-clear').addEventListener('click', () => {
    document.getElementById('personalization-file').value = '';
    renderPersonalizationFile();
});
document.getElementById('personalization-text').addEventListener('input', () => personalizationError(''));

// ==========================================
// CARRITO (usa el módulo compartido ./cart.js)
// ==========================================
document.getElementById('add-to-cart-btn').addEventListener('click', async () => {
    if (!currentProduct || addingToCart || !requireSize()) return;
    const qty = parseInt(document.getElementById('quantity').value, 10) || 1;
    await handleAddToCart(selectedSize, qty);
});

document.getElementById('buy-now-btn').addEventListener('click', async () => {
    if (!currentProduct || addingToCart) return;
    if (availableToAdd() > 0) {
        if (!requireSize()) return;
        const qty = parseInt(document.getElementById('quantity').value, 10) || 1;
        const added = await handleAddToCart(selectedSize, qty);
        // Un producto personalizable sin personalizacion no se lleva al carrito.
        if (!added && currentProduct.personalizable) return;
    }
    if (cartQuantityFor(currentProduct.id) > 0) window.location.href = 'carrito';
});

// Devuelve cuantas unidades agrego (0 si falto la personalizacion o fallo la subida).
async function handleAddToCart(size, qty) {
    let personalization = null;
    if (currentProduct.personalizable) {
        const input = readPersonalization();
        if (!input) return 0;
        personalization = { text: input.text, file: null };
        if (input.file) {
            setAddingToCart(true);
            try {
                personalization.file = await uploadPersonalizationFile(input.file);
            } catch (err) {
                personalizationError(err.message);
                return 0;
            } finally {
                setAddingToCart(false);
            }
        }
    }

    const added = addToCart({
        id: currentProduct.id,
        name: currentProduct.name,
        price: currentProduct.price,
        image: currentProduct.images[0],
        size: size,
        quantity: qty,
        maxQty: currentProduct.stockLimit,
        ...(personalization ? { personalization } : {})
    });
    // Cada encargo personalizado es una linea aparte: el formulario queda
    // limpio para el siguiente.
    if (added && personalization) resetPersonalization();
    renderStock();
    return added;
}

// ==========================================
// PRODUCTOS RELACIONADOS
// ==========================================
async function renderRelated() {
    const related = await fetchRelatedProducts(currentProduct.relatedIds);
    document.getElementById('related-products').innerHTML = related.map(p => `
        <a href="producto?id=${p.id}" class="bg-white rounded-2xl border border-primary-100 overflow-hidden hover:shadow-xl transition-all group">
            <div class="overflow-hidden bg-primary-50">
                <img src="${p.images[0]}" alt="${p.name}" class="w-full h-52 object-cover group-hover:scale-105 transition-transform duration-500">
            </div>
            <div class="p-4">
                <h4 class="font-medium text-sm line-clamp-2 mb-1 text-black">${p.name}</h4>
                <p class="font-bold text-black">${wcPrice(p.price)}</p>
            </div>
        </a>
    `).join('');
}

// El drawer mobile vive ahora en ./ui.js y lo inicializa el layout.

// ==========================================
// INICIALIZACIÓN
// ==========================================
loadProduct();

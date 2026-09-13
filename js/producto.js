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
        badge: badge,
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
    const names = { papeleria: 'Papelería', 'corte-laser': 'Corte láser', personalizados: 'Personalizados', otros: 'Otros' };
    return names[cat] || cat;
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
        <img src="${img}" alt="${currentProduct.name}" class="w-full flex-shrink-0 object-cover" style="aspect-ratio: 6/7;">
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
// CANTIDAD
// ==========================================
document.getElementById('qty-minus').addEventListener('click', () => {
    const input = document.getElementById('quantity');
    if (parseInt(input.value) > 1) input.value = parseInt(input.value) - 1;
});

document.getElementById('qty-plus').addEventListener('click', () => {
    const input = document.getElementById('quantity');
    if (parseInt(input.value) < 10) input.value = parseInt(input.value) + 1;
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

document.getElementById('add-to-cart-btn').addEventListener('click', () => {
    if (!currentProduct || !requireSize()) return;
    const qty = parseInt(document.getElementById('quantity').value);
    handleAddToCart(selectedSize, qty);
});

document.getElementById('buy-now-btn').addEventListener('click', () => {
    if (!currentProduct || !requireSize()) return;
    const qty = parseInt(document.getElementById('quantity').value);
    handleAddToCart(selectedSize, qty);
    window.location.href = 'carrito';
});

// ==========================================
// CARRITO (usa el módulo compartido js/cart.js)
// ==========================================
function handleAddToCart(size, qty) {
    addToCart({
        id: currentProduct.id,
        name: currentProduct.name,
        price: currentProduct.price,
        image: currentProduct.images[0],
        size: size,
        quantity: qty
    });
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

// ==========================================
// DRAWER MOBILE
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

toggle.addEventListener('click', () => {
    if (drawer.classList.contains('translate-x-full')) openDrawer();
    else closeDrawer();
});

overlay.addEventListener('click', closeDrawer);

// ==========================================
// INICIALIZACIÓN
// ==========================================
loadProduct();

import {
    WC_CATEGORIES,
    wcCategoryName,
    wcFetchJson,
    wcNormalize,
    wcPrice,
    wcRenderError,
    wcStockLimit
} from './config.js';
import { addToCart } from './cart.js';

// ==========================================
// DATOS DE PRODUCTOS
// Se cargan desde WooCommerce en init(). Este array queda
// vacío hasta que llegue la respuesta de la API.
// ==========================================
let productsData = [];

// Guarda el error de la API para mostrar el estado correcto en pantalla
// (un cliente real no tiene que ver productos "demo" inventados).
let productsLoadError = null;

// ==========================================
// WOOCOMMERCE: TRAER PRODUCTOS
// ==========================================

// Convierte un producto de WooCommerce al formato que usa renderProducts()
function mapWCProduct(p) {
    const price = parseFloat(p.price || p.regular_price || 0);
    const regular = parseFloat(p.regular_price || 0);
    const onSale = p.on_sale && regular > price;

    let badge = null;
    if (onSale) {
        const pct = Math.round(((regular - price) / regular) * 100);
        badge = `-${pct}%`;
    } else {
        // "Nuevo" si se creó hace menos de 14 días
        const created = new Date(p.date_created);
        const days = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
        if (days <= 14) badge = 'NUEVO';
    }

    return {
        id: p.id,
        name: p.name,
        price: price,
        originalPrice: onSale ? regular : null,
        // Tomamos el slug de la primera categoría asignada en WooCommerce.
        // Tiene que coincidir con WC_CATEGORIES (./categories.js)
        category: p.categories && p.categories.length ? p.categories[0].slug : '',
        image: p.images && p.images.length ? p.images[0].src : 'https://placehold.co/300x350/E6EBB1/4A501C?text=Sin+imagen',
        badge: badge,
        stockStatus: p.stock_status, // 'instock' | 'outofstock' | 'onbackorder'
        stockLimit: wcStockLimit(p)  // unidades que se pueden comprar (0 = agotado)
    };
}

async function fetchProductsFromWC() {
    productsLoadError = null;
    try {
        const data = await wcFetchJson('products', { per_page: 100, status: 'publish' });
        productsData = data.map(mapWCProduct);
    } catch (err) {
        productsData = [];
        productsLoadError = err;
    }
}

// ==========================================
// ESTADO GLOBAL
// ==========================================
let currentCategory = 'all';
let currentPriceMin = null; // null = sin límite
let currentPriceMax = null;
let currentSort = 'default';
let currentSearch = '';
let productsReady = false;

// Clases del botón de categoría activo / inactivo
const CAT_ACTIVE = ['bg-primary-50', 'text-primary-800', 'font-semibold'];
const CAT_INACTIVE = ['text-neutral-700'];
const CAT_MOBILE_ACTIVE = ['bg-primary-700', 'font-semibold'];

// ==========================================
// UTILIDADES
// ==========================================

// Leer parámetros de la URL
function getURLParam(param) {
    const params = new URLSearchParams(window.location.search);
    return params.get(param);
}

// Verificar rango de precio (pesos uruguayos). Los límites son inclusivos;
// si el usuario carga el mínimo mayor que el máximo, se interpretan al revés.
function checkPrice(price, min, max) {
    if (min !== null && max !== null && min > max) [min, max] = [max, min];
    if (min !== null && price < min) return false;
    if (max !== null && price > max) return false;
    return true;
}

// Valor de un campo de precio: vacío o inválido = sin límite
function parsePriceInput(value) {
    const n = parseFloat(String(value).replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? n : null;
}

// Ordenar productos
function sortProducts(products, sort) {
    const sorted = [...products];
    switch(sort) {
        case 'price-asc': return sorted.sort((a, b) => a.price - b.price);
        case 'price-desc': return sorted.sort((a, b) => b.price - a.price);
        case 'name-asc': return sorted.sort((a, b) => a.name.localeCompare(b.name));
        case 'name-desc': return sorted.sort((a, b) => b.name.localeCompare(a.name));
        default: return sorted;
    }
}

// La búsqueda mira nombre y categoría, sin distinguir tildes ni mayúsculas.
// Todas las palabras tienen que aparecer ("soporte laptop" = "laptop soporte").
function matchesSearch(product, query) {
    const words = wcNormalize(query).split(' ').filter(Boolean);
    if (!words.length) return true;
    const haystack = wcNormalize(`${product.name} ${wcCategoryName(product.category)}`);
    return words.every(w => haystack.includes(w));
}

// ==========================================
// RENDERIZAR PRODUCTOS
// ==========================================
function renderProducts() {
    const grid = document.getElementById('products-grid');
    const loading = document.getElementById('loading');
    const noResults = document.getElementById('no-results');
    const countEl = document.getElementById('products-count');

    // Hasta que llegue la API, init() se encarga del primer render
    if (!productsReady) return;

    loading.classList.remove('hidden');

    // Filtrar productos
    let filtered = productsData.filter(p => {
        const matchCategory = currentCategory === 'all' || p.category === currentCategory;
        const matchSearch = matchesSearch(p, currentSearch);
        const matchPrice = checkPrice(p.price, currentPriceMin, currentPriceMax);
        return matchCategory && matchSearch && matchPrice;
    });

    // Ordenar
    filtered = sortProducts(filtered, currentSort);

    // Simular carga
    setTimeout(() => {
        loading.classList.add('hidden');

        // Si la API falló, mostramos el estado de error en vez de
        // "no se encontraron productos", que confundiría al cliente.
        if (productsLoadError) {
            noResults.classList.add('hidden');
            countEl.textContent = '';
            wcRenderError('products-grid', productsLoadError);
            return;
        }

        if (filtered.length === 0) {
            grid.innerHTML = '';
            noResults.classList.remove('hidden');
            countEl.textContent = '0 productos';
            return;
        }

        noResults.classList.add('hidden');
        countEl.textContent = `${filtered.length} producto${filtered.length !== 1 ? 's' : ''}`;

        grid.innerHTML = filtered.map(product => `
            <div class="bg-white rounded-2xl border border-primary-100 overflow-hidden hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group flex flex-col">
                <a href="producto?id=${product.id}" class="block flex-1">
                    <div class="relative overflow-hidden bg-primary-50">
                        <img src="${product.image}"
                             alt="${product.name}"
                             class="w-full h-64 object-cover group-hover:scale-105 transition-transform duration-500">
                        ${product.badge ? `
                            <span class="absolute top-3 left-3 ${product.badge.includes('-') ? 'bg-accent text-black' : 'bg-teal text-black'} text-xs font-semibold px-3 py-1 rounded-full">
                                ${product.badge}
                            </span>
                        ` : ''}
                    </div>
                    <div class="p-5">
                        <p class="text-xs text-mustard uppercase tracking-wider font-medium mb-1">${wcCategoryName(product.category)}</p>
                        <h3 class="font-medium text-lg leading-snug mb-2 line-clamp-2 text-black">${product.name}</h3>
                        <div class="flex items-baseline gap-2">
                            <span class="text-xl font-bold text-black">${wcPrice(product.price)}</span>
                            ${product.originalPrice ? `<span class="text-sm text-neutral-400 line-through">${wcPrice(product.originalPrice)}</span>` : ''}
                        </div>
                    </div>
                </a>
                <div class="px-5 pb-5">
                    ${product.stockLimit > 0 ? `
                        <button onclick="handleAddToCart(${product.id})"
                                class="w-full bg-primary-700 hover:bg-primary-800 text-white py-2.5 rounded-full transition font-semibold text-sm">
                            Añadir al carrito
                        </button>
                    ` : `
                        <button disabled
                                class="w-full bg-neutral-200 text-neutral-500 py-2.5 rounded-full font-semibold text-sm cursor-not-allowed">
                            Sin stock
                        </button>
                    `}
                </div>
            </div>
        `).join('');
    }, 300);
}

// ==========================================
// CARRITO (usa el módulo compartido ./cart.js)
// ==========================================
function handleAddToCart(productId) {
    const product = productsData.find(p => p.id === productId);
    if (product) {
        addToCart({
            id: product.id,
            name: product.name,
            price: product.price,
            image: product.image,
            maxQty: product.stockLimit
        });
    }
}

// ==========================================
// FILTROS DESKTOP
// ==========================================
function markDesktopCategory(category) {
    document.querySelectorAll('.category-btn').forEach(btn => {
        const active = btn.dataset.category === category;
        btn.classList.remove(...(active ? CAT_INACTIVE : CAT_ACTIVE));
        btn.classList.add(...(active ? CAT_ACTIVE : CAT_INACTIVE));
    });
}

function markMobileCategory(category) {
    document.querySelectorAll('.category-btn-mobile').forEach(btn => {
        btn.classList.toggle(CAT_MOBILE_ACTIVE[0], btn.dataset.category === category);
        btn.classList.toggle(CAT_MOBILE_ACTIVE[1], btn.dataset.category === category);
    });
}

function setupDesktopFilters() {
    // Categorías
    document.querySelectorAll('.category-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            currentCategory = btn.dataset.category;
            markDesktopCategory(currentCategory);
            renderProducts();
        });
    });

    // Ordenar
    document.getElementById('sort-select').addEventListener('change', (e) => {
        currentSort = e.target.value;
        renderProducts();
    });
}

// ==========================================
// FILTROS MOBILE (DRAWER)
// ==========================================
function setupMobileFilters() {
    const filtrosDrawer = document.getElementById('filtros-drawer');
    const filtrosOverlay = document.getElementById('drawer-overlay');
    const filtrosToggle = document.getElementById('filtros-toggle');
    const closeFiltrosBtn = document.getElementById('close-filtros');
    const aplicarFiltrosBtn = document.getElementById('aplicar-filtros');

    function openFiltros() {
        filtrosDrawer.classList.remove('-translate-x-full');
        filtrosOverlay.classList.remove('hidden');
        setTimeout(() => filtrosOverlay.classList.add('opacity-100'), 10);
    }

    function closeFiltros() {
        filtrosDrawer.classList.add('-translate-x-full');
        filtrosOverlay.classList.remove('opacity-100');
        setTimeout(() => filtrosOverlay.classList.add('hidden'), 300);
    }

    filtrosToggle.addEventListener('click', openFiltros);
    closeFiltrosBtn.addEventListener('click', closeFiltros);
    filtrosOverlay.addEventListener('click', closeFiltros);

    // Categorías mobile
    document.querySelectorAll('.category-btn-mobile').forEach(btn => {
        btn.addEventListener('click', () => {
            currentCategory = btn.dataset.category;
            markMobileCategory(currentCategory);
        });
    });

    // Aplicar filtros (el precio ya queda sincronizado por setupPriceFilter)
    aplicarFiltrosBtn.addEventListener('click', () => {
        markDesktopCategory(currentCategory);
        renderProducts();
        closeFiltros();
    });
}

// ==========================================
// FILTRO DE PRECIO (MÍN / MÁX)
// ==========================================
// Hay dos pares de campos (sidebar desktop y drawer mobile): se mantienen
// sincronizados. Filtra mientras se escribe (con debounce); en mobile el
// resultado se ve al cerrar el drawer con "Ver resultados".
function setupPriceFilter() {
    const inputs = document.querySelectorAll('[data-price]');
    const clearBtns = document.querySelectorAll('[data-price-clear]');
    let priceTimeout;

    function updatePriceState() {
        const min = document.querySelector('[data-price="min"]').value;
        const max = document.querySelector('[data-price="max"]').value;
        currentPriceMin = parsePriceInput(min);
        currentPriceMax = parsePriceInput(max);
        const active = currentPriceMin !== null || currentPriceMax !== null;
        clearBtns.forEach(btn => btn.classList.toggle('hidden', !active));
    }

    inputs.forEach(input => {
        input.addEventListener('input', () => {
            document.querySelectorAll(`[data-price="${input.dataset.price}"]`)
                .forEach(other => { if (other !== input) other.value = input.value; });
            updatePriceState();
            clearTimeout(priceTimeout);
            priceTimeout = setTimeout(renderProducts, 400);
        });

        // Enter aplica ya, sin esperar el debounce
        input.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            clearTimeout(priceTimeout);
            renderProducts();
            input.blur();
        });
    });

    clearBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            inputs.forEach(input => { input.value = ''; });
            updatePriceState();
            clearTimeout(priceTimeout);
            renderProducts();
        });
    });
}

// ==========================================
// BÚSQUEDA
// ==========================================
// Hay dos buscadores (navbar desktop y encabezado mobile): se mantienen sincronizados.
function setupSearch() {
    const inputs = document.querySelectorAll('[data-search]');
    let searchTimeout;

    inputs.forEach(input => {
        input.addEventListener('input', () => {
            inputs.forEach(other => { if (other !== input) other.value = input.value; });
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                currentSearch = input.value;
                renderProducts();
            }, 300);
        });

        // Enter aplica ya, sin esperar el debounce (y cierra el teclado en mobile)
        input.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            clearTimeout(searchTimeout);
            currentSearch = input.value;
            renderProducts();
            input.blur();
        });
    });
}

// El navbar inteligente vive ahora en ./ui.js y lo inicializa el layout.

// ==========================================
// INICIALIZACIÓN
// ==========================================
async function init() {
    // Mostrar loading mientras llega la API
    document.getElementById('loading').classList.remove('hidden');

    // Leer categoría de la URL
    const categoryFromURL = getURLParam('cat');
    if (categoryFromURL) {
        currentCategory = categoryFromURL;
        markDesktopCategory(currentCategory);
        markMobileCategory(currentCategory);
    }

    // Leer búsqueda de la URL (viene del buscador de otras páginas)
    const searchFromURL = getURLParam('q');
    if (searchFromURL) {
        currentSearch = searchFromURL;
        document.querySelectorAll('[data-search]').forEach(i => { i.value = searchFromURL; });
    }

    // Los listeners van antes de pedir la API: si la respuesta tarda,
    // lo que se escriba mientras tanto no se pierde.
    setupDesktopFilters();
    setupMobileFilters();
    setupPriceFilter();
    setupSearch();

    // Traer productos reales de WooCommerce
    await fetchProductsFromWC();
    productsReady = true;

    // Renderizar productos
    renderProducts();
}

// El boton "Añadir al carrito" de cada tarjeta se arma con innerHTML y usa
// onclick, asi que la funcion tiene que estar en window.
window.handleAddToCart = handleAddToCart;

// Iniciar
init();

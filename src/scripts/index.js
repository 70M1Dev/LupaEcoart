import { wcCategoryName, wcFetchJson, wcIsPersonalizable, wcPrice, wcRenderError, wcStockLimit } from './config.js';
import { addToCart } from './cart.js';

// ==========================================
// PRODUCTOS DESTACADOS (HOME) - WooCommerce
// ==========================================

// Igual al mapeo usado en productos.js
function mapWCProductHome(p) {
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

    return {
        id: p.id,
        name: p.name,
        price: price,
        originalPrice: onSale ? regular : null,
        category: p.categories && p.categories.length ? p.categories[0].slug : '',
        image: p.images && p.images.length ? p.images[0].src : 'https://placehold.co/300x350/E6EBB1/4A501C?text=Sin+imagen',
        badge: badge,
        stockLimit: wcStockLimit(p), // unidades que se pueden comprar (0 = agotado)
        personalizable: wcIsPersonalizable(p) // se agrega desde la ficha, con la personalizacion
    };
}

// Lanza si la API no responde. El caller muestra el estado de error.
async function fetchFeaturedProducts() {
    // Primero intentamos con productos marcados como "Destacado" en WooCommerce
    let data = await wcFetchJson('products', { featured: true, per_page: 4, status: 'publish' });

    // Si no marcaste ningún producto como destacado, mostramos los últimos publicados
    if (!data.length) {
        data = await wcFetchJson('products', { per_page: 4, orderby: 'date', order: 'desc', status: 'publish' });
    }

    return data.map(mapWCProductHome);
}

let featuredProductsData = [];

function renderFeaturedProducts(products) {
    const grid = document.getElementById('featured-products');
    const loading = document.getElementById('featured-loading');
    loading.classList.add('hidden');

    grid.innerHTML = products.map(product => `
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
                ${product.stockLimit > 0 && product.personalizable ? `
                    <a href="producto?id=${product.id}" class="block text-center w-full bg-primary-700 hover:bg-primary-800 text-white py-2.5 rounded-full transition font-semibold text-sm">
                        Personalizar
                    </a>
                ` : product.stockLimit > 0 ? `
                    <button onclick="handleAddToCartHome(${product.id})" class="w-full bg-primary-700 hover:bg-primary-800 text-white py-2.5 rounded-full transition font-semibold text-sm">
                        Añadir al carrito
                    </button>
                ` : `
                    <button disabled class="w-full bg-neutral-200 text-neutral-500 py-2.5 rounded-full font-semibold text-sm cursor-not-allowed">
                        Sin stock
                    </button>
                `}
            </div>
        </div>
    `).join('');
}

function handleAddToCartHome(productId) {
    const product = featuredProductsData.find(p => p.id === productId);
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

// El boton "Añadir al carrito" de cada tarjeta se arma con innerHTML y usa
// onclick, asi que la funcion tiene que estar en window.
window.handleAddToCartHome = handleAddToCartHome;

async function initFeaturedProducts() {
    try {
        featuredProductsData = await fetchFeaturedProducts();
        renderFeaturedProducts(featuredProductsData);
    } catch (err) {
        const loading = document.getElementById('featured-loading');
        if (loading) loading.classList.add('hidden');
        wcRenderError('featured-products', err);
    }
}

initFeaturedProducts();

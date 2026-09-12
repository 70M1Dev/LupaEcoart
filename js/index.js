// ==========================================
// PRODUCTOS DESTACADOS (HOME) - WooCommerce
// ==========================================

function getCategoryNameHome(cat) {
    const names = { cuadros: 'Cuadros', ceramica: 'Cerámica', macrame: 'Macramé', velas: 'Velas & Aromas', decoracion: 'Decoración' };
    return names[cat] || cat;
}

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
        image: p.images && p.images.length ? p.images[0].src : 'https://placehold.co/300x350/EDE3F5/2C0847?text=Sin+imagen',
        badge: badge
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
            <a href="producto.html?id=${product.id}" class="block flex-1">
                <div class="relative overflow-hidden bg-primary-50">
                    <img src="${product.image}"
                         alt="${product.name}"
                         class="w-full h-64 object-cover group-hover:scale-105 transition-transform duration-500">
                    ${product.badge ? `
                        <span class="absolute top-3 left-3 ${product.badge.includes('-') ? 'bg-accent' : 'bg-primary-800'} text-white text-xs font-semibold px-3 py-1 rounded-full">
                            ${product.badge}
                        </span>
                    ` : ''}
                </div>
                <div class="p-5">
                    <p class="text-xs text-primary-500 uppercase tracking-wider font-medium mb-1">${getCategoryNameHome(product.category)}</p>
                    <h3 class="font-medium text-lg leading-snug mb-2 line-clamp-2 text-black">${product.name}</h3>
                    <div class="flex items-baseline gap-2">
                        <span class="text-xl font-bold text-black">${wcPrice(product.price)}</span>
                        ${product.originalPrice ? `<span class="text-sm text-neutral-400 line-through">${wcPrice(product.originalPrice)}</span>` : ''}
                    </div>
                </div>
            </a>
            <div class="px-5 pb-5">
                <button onclick="handleAddToCartHome(${product.id})" class="w-full bg-primary-800 hover:bg-primary-600 text-white py-2.5 rounded-full transition font-semibold text-sm">
                    Añadir al carrito
                </button>
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
            image: product.image
        });
    }
}

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

// ==========================================
// DATOS DE EJEMPLO — solo para el boceto local
// ==========================================
// config.js carga este archivo unicamente en localhost / *.local.
// Imita la forma de la respuesta de la WooCommerce REST API para que
// el resto del codigo funcione igual que con el backend real.
// ==========================================

function demoImg(bg, fg, text) {
    return { src: `https://placehold.co/600x700/${bg}/${fg}?font=poppins&text=${encodeURIComponent(text)}` };
}

const DEMO_DAY = 24 * 60 * 60 * 1000;
const demoDate = daysAgo => new Date(Date.now() - daysAgo * DEMO_DAY).toISOString();

const DEMO_PRODUCTS = [
    {
        id: 1, name: 'Cuadro Botánico en Papel Reciclado', price: '2890', regular_price: '3400', on_sale: true,
        featured: true, date_created: demoDate(40), categories: [{ slug: 'cuadros' }],
        images: [demoImg('2C0847', 'FFFFFF', 'Cuadro Botánico'), demoImg('EDE3F5', '2C0847', 'Detalle')],
        description: '<p>Composición de hojas prensadas sobre papel 100% reciclado, enmarcada en madera recuperada. Cada pieza es única.</p>',
        attributes: [{ name: 'Medida', options: ['20x30', '30x40', '40x50'] }],
        related_ids: [2, 5, 7, 3], stock_status: 'instock'
    },
    {
        id: 2, name: 'Maceta de Cerámica Esmaltada', price: '1650', regular_price: '1650', on_sale: false,
        featured: true, date_created: demoDate(5), categories: [{ slug: 'ceramica' }],
        images: [demoImg('3D1260', 'FFFFFF', 'Maceta Cerámica'), demoImg('D9C6EB', '2C0847', 'Esmalte')],
        description: '<p>Modelada a mano con arcilla local y esmaltes libres de plomo. Incluye orificio de drenaje.</p>',
        attributes: [{ name: 'Tamaño', options: ['S', 'M', 'L'] }],
        related_ids: [4, 6, 1, 8], stock_status: 'instock'
    },
    {
        id: 3, name: 'Tapiz de Macramé Algodón Natural', price: '3200', regular_price: '3200', on_sale: false,
        featured: true, date_created: demoDate(60), categories: [{ slug: 'macrame' }],
        images: [demoImg('5A0B4D', 'FFFFFF', 'Tapiz Macramé'), demoImg('EDE3F5', '5A0B4D', 'Tejido')],
        description: '<p>Tejido a mano con cuerda de algodón reciclado sobre rama de eucalipto.</p>',
        attributes: [],
        related_ids: [7, 1, 5, 2], stock_status: 'instock'
    },
    {
        id: 4, name: 'Vela de Soja en Frasco Reutilizado', price: '690', regular_price: '850', on_sale: true,
        featured: true, date_created: demoDate(2), categories: [{ slug: 'velas' }],
        images: [demoImg('1F1450', 'FFFFFF', 'Vela de Soja'), demoImg('D9C6EB', '1F1450', 'Aroma')],
        description: '<p>Cera de soja con aceites esenciales de lavanda. Frasco de vidrio recuperado, listo para reutilizar.</p>',
        attributes: [],
        related_ids: [6, 2, 8, 3], stock_status: 'instock'
    },
    {
        id: 5, name: 'Lámina Ilustrada Fauna Nativa', price: '1200', regular_price: '1200', on_sale: false,
        featured: false, date_created: demoDate(30), categories: [{ slug: 'cuadros' }],
        images: [demoImg('EDE3F5', '2C0847', 'Fauna Nativa')],
        description: '<p>Impresión giclée sobre papel de algodón con tintas a base de agua.</p>',
        attributes: [{ name: 'Medida', options: ['A4', 'A3'] }],
        related_ids: [1, 7, 3, 8], stock_status: 'instock'
    },
    {
        id: 6, name: 'Set de Cuencos Cerámica Artesanal', price: '2400', regular_price: '2400', on_sale: false,
        featured: false, date_created: demoDate(9), categories: [{ slug: 'ceramica' }],
        images: [demoImg('522077', 'FFFFFF', 'Set de Cuencos')],
        description: '<p>Tres cuencos de gres torneados a mano, aptos para alimentos y lavavajillas.</p>',
        attributes: [],
        related_ids: [2, 4, 8, 1], stock_status: 'instock'
    },
    {
        id: 7, name: 'Portamacetas Colgante de Macramé', price: '980', regular_price: '980', on_sale: false,
        featured: false, date_created: demoDate(80), categories: [{ slug: 'macrame' }],
        images: [demoImg('D9C6EB', '3D1260', 'Portamacetas')],
        description: '<p>Colgante de cuerda reciclada con aro de madera. Soporta macetas de hasta 18 cm.</p>',
        attributes: [],
        related_ids: [3, 2, 6, 1], stock_status: 'instock'
    },
    {
        id: 8, name: 'Espejo con Marco de Madera Recuperada', price: '6800', regular_price: '7500', on_sale: true,
        featured: false, date_created: demoDate(20), categories: [{ slug: 'decoracion' }],
        images: [demoImg('2C0847', 'D9C6EB', 'Espejo Madera')],
        description: '<p>Marco realizado con tablas de pallets recuperados, lijado y terminado con cera natural.</p>',
        attributes: [{ name: 'Medida', options: ['50 cm', '70 cm'] }],
        related_ids: [1, 6, 3, 4], stock_status: 'instock'
    }
];

// Responde como lo haria la API para los endpoints que usa el frontend.
async function wcDemoResponse(endpoint, params = {}) {
    await new Promise(r => setTimeout(r, 250)); // simula latencia

    const byId = endpoint.match(/^products\/(\d+)$/);
    if (byId) {
        const product = DEMO_PRODUCTS.find(p => p.id === Number(byId[1]));
        if (!product) throw new Error('Producto de ejemplo no encontrado');
        return product;
    }

    if (endpoint === 'products') {
        let list = [...DEMO_PRODUCTS];
        if (String(params.featured) === 'true') list = list.filter(p => p.featured);
        if (params.orderby === 'date') list.sort((a, b) => new Date(b.date_created) - new Date(a.date_created));
        if (params.per_page) list = list.slice(0, Number(params.per_page));
        return list;
    }

    throw new Error(`Endpoint sin datos de ejemplo: ${endpoint}`);
}

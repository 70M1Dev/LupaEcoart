// ==========================================
// DATOS DE EJEMPLO — solo para el boceto local
// ==========================================
// config.js lo importa solo cuando no hay backend configurado.
// Imita la forma de la respuesta de la WooCommerce REST API para que
// el resto del codigo funcione igual que con el backend real.
// ==========================================

function demoImg(bg, fg, text) {
    return { src: `https://placehold.co/600x700/${bg}/${fg}?font=poppins&text=${encodeURIComponent(text)}` };
}

const DEMO_DAY = 24 * 60 * 60 * 1000;
const demoDate = daysAgo => new Date(Date.now() - daysAgo * DEMO_DAY).toISOString();

export const DEMO_PRODUCTS = [
    {
        id: 1, name: 'Cuadro Botánico en Papel Reciclado', price: '2890', regular_price: '3400', on_sale: true,
        featured: true, date_created: demoDate(40), categories: [{ slug: 'papeleria' }],
        images: [demoImg('5E6622', 'FFFFFF', 'Cuadro Botánico'), demoImg('E6EBB1', '5E6622', 'Detalle')],
        description: '<p>Composición de hojas prensadas sobre papel 100% reciclado, enmarcada en madera recuperada. Cada pieza es única.</p>',
        attributes: [{ name: 'Medida', options: ['20x30', '30x40', '40x50'] }],
        related_ids: [2, 5, 7, 3], stock_status: 'instock'
    },
    {
        id: 2, name: 'Maceta de Cerámica Esmaltada', price: '1650', regular_price: '1650', on_sale: false,
        featured: true, date_created: demoDate(5), categories: [{ slug: 'corte-laser' }],
        images: [demoImg('8F9B2F', 'FFFFFF', 'Maceta Cerámica'), demoImg('FCA321', '5E6622', 'Esmalte')],
        description: '<p>Modelada a mano con arcilla local y esmaltes libres de plomo. Incluye orificio de drenaje.</p>',
        attributes: [{ name: 'Tamaño', options: ['S', 'M', 'L'] }],
        related_ids: [4, 6, 1, 8], stock_status: 'instock'
    },
    {
        id: 3, name: 'Tapiz de Macramé Algodón Natural', price: '3200', regular_price: '3200', on_sale: false,
        featured: true, date_created: demoDate(60), categories: [{ slug: 'personalizados' }],
        images: [demoImg('A68A26', 'FFFFFF', 'Tapiz Macramé'), demoImg('E6EBB1', 'A68A26', 'Tejido')],
        description: '<p>Tejido a mano con cuerda de algodón reciclado sobre rama de eucalipto.</p>',
        attributes: [],
        related_ids: [7, 1, 5, 2], stock_status: 'instock'
    },
    {
        id: 4, name: 'Vela de Soja en Frasco Reutilizado', price: '690', regular_price: '850', on_sale: true,
        featured: true, date_created: demoDate(2), categories: [{ slug: 'otros' }],
        images: [demoImg('7ABFB1', 'FFFFFF', 'Vela de Soja'), demoImg('FCA321', '7ABFB1', 'Aroma')],
        description: '<p>Cera de soja con aceites esenciales de lavanda. Frasco de vidrio recuperado, listo para reutilizar.</p>',
        attributes: [],
        related_ids: [6, 2, 8, 3], stock_status: 'instock'
    },
    {
        id: 5, name: 'Lámina Ilustrada Fauna Nativa', price: '1200', regular_price: '1200', on_sale: false,
        featured: false, date_created: demoDate(30), categories: [{ slug: 'papeleria' }],
        images: [demoImg('E6EBB1', '5E6622', 'Fauna Nativa')],
        description: '<p>Impresión giclée sobre papel de algodón con tintas a base de agua.</p>',
        attributes: [{ name: 'Medida', options: ['A4', 'A3'] }],
        related_ids: [1, 7, 3, 8], stock_status: 'instock'
    },
    {
        id: 6, name: 'Set de Cuencos Cerámica Artesanal', price: '2400', regular_price: '2400', on_sale: false,
        featured: false, date_created: demoDate(9), categories: [{ slug: 'corte-laser' }],
        images: [demoImg('76802A', 'FFFFFF', 'Set de Cuencos')],
        description: '<p>Tres cuencos de gres torneados a mano, aptos para alimentos y lavavajillas.</p>',
        attributes: [],
        related_ids: [2, 4, 8, 1], stock_status: 'instock'
    },
    {
        id: 7, name: 'Portamacetas Colgante de Macramé', price: '980', regular_price: '980', on_sale: false,
        featured: false, date_created: demoDate(80), categories: [{ slug: 'personalizados' }],
        images: [demoImg('FCA321', '8F9B2F', 'Portamacetas')],
        description: '<p>Colgante de cuerda reciclada con aro de madera. Soporta macetas de hasta 18 cm.</p>',
        attributes: [],
        related_ids: [3, 2, 6, 1], stock_status: 'instock'
    },
    {
        id: 8, name: 'Espejo con Marco de Madera Recuperada', price: '6800', regular_price: '7500', on_sale: true,
        featured: false, date_created: demoDate(20), categories: [{ slug: 'otros' }],
        images: [demoImg('5E6622', 'FCA321', 'Espejo Madera')],
        description: '<p>Marco realizado con tablas de pallets recuperados, lijado y terminado con cera natural.</p>',
        attributes: [{ name: 'Medida', options: ['50 cm', '70 cm'] }],
        related_ids: [1, 6, 3, 4], stock_status: 'instock'
    }
];

// Responde como lo haria la API para los endpoints que usa el frontend.
export async function wcDemoResponse(endpoint, params = {}) {
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

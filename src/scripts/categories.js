// ==========================================
// CATEGORIAS — Lupa Ecoart
// ==========================================
// Vive aparte de config.js porque tambien lo usan los componentes .astro, que
// se ejecutan en Node al compilar: config.js mira `location` y ahi no existe.
// ==========================================

// Categorias de WooCommerce: slug → nombre visible.
// Los slugs tienen que coincidir exactamente con los creados en WordPress.
export const WC_CATEGORIES = {
    papeleria: 'Papelería',
    'corte-laser': 'Corte láser',
    personalizados: 'Personalizados',
    reciclables: 'Reciclables',
    otros: 'Otros'
};

export function wcCategoryName(slug) {
    return WC_CATEGORIES[slug] || slug;
}

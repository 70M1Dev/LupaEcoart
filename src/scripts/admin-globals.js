// ==========================================
// PUENTE PARA EL PANEL DE TIENDA — Lupa Ecoart
// ==========================================
// public/js/admin.js sigue siendo un script clasico (no un modulo): espera
// encontrar la config en el scope global, como cuando cada HTML cargaba
// js/config.js con un <script src>. Este modulo le deja ahi lo que necesita
// antes de que arranque.
//
// El orden esta garantizado: admin.astro carga este modulo primero y admin.js
// con `defer`, y los dos se ejecutan en el orden del documento, despues de
// parsear el HTML.
// ==========================================

import { WC_CATEGORIES, WC_CONFIG, WC_IS_LOCAL_DEV, wcNormalize, wcPrice } from './config.js';
import { DEMO_PRODUCTS } from './demo-data.js';

window.WC_CONFIG = WC_CONFIG;
window.WC_IS_LOCAL_DEV = WC_IS_LOCAL_DEV;
window.WC_CATEGORIES = WC_CATEGORIES;
window.wcNormalize = wcNormalize;
window.wcPrice = wcPrice;

// Modo prueba solo en local: /admin?demo trabaja en memoria con los productos
// de demo-data.js, sin tocar la tienda real. admin.js decide mirando si
// DEMO_PRODUCTS existe, asi que fuera de ese caso no se lo dejamos.
if (WC_IS_LOCAL_DEV && new URLSearchParams(location.search).has('demo')) {
    window.DEMO_PRODUCTS = DEMO_PRODUCTS;
}

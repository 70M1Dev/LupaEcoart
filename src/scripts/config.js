// ==========================================
// CONFIGURACION — Lupa Ecoart
// ==========================================
// Este archivo ES PUBLICO (se compila en el bundle que se sirve al navegador).
// NUNCA pongas aca las API keys de WooCommerce.
//
// Arquitectura:
//
//   Navegador
//      ├─ Frontend estatico  → GitHub Pages  (el build de Astro)
//      └─ PROXY_URL          → Cloudflare Worker (worker.js)
//                                  └─ agrega las API keys
//                                     y le pega a WordPress + WooCommerce
//
// El navegador nunca ve las credenciales: viven como secrets en Cloudflare.
//
// Para desarrollo local todo esto se sobrescribe con variables de entorno en
// un archivo .env (gitignored). Ver .env.example.
// ==========================================

// Las categorias viven aparte para que tambien las puedan leer los .astro.
export { WC_CATEGORIES, wcCategoryName } from './categories.js';

const env = import.meta.env;

export const WC_CONFIG = {
    // ------------------------------------------------------------------
    // ⚙️  UNICO VALOR A CAMBIAR AL DEPLOYAR
    // ------------------------------------------------------------------
    // URL del Cloudflare Worker que hace de proxy. Sin barra final.
    //
    //   Con dominio propio:  https://api.lupaecoart.com
    //   Sin dominio (gratis): https://lupaecoart-wc-proxy.<tu-subdominio>.workers.dev
    //
    // Poné PUBLIC_WC_PROXY_URL='' en .env para pegarle directo a WordPress
    // (solo desarrollo local).
    PROXY_URL: env.PUBLIC_WC_PROXY_URL ?? 'https://lupaecoart-wc-proxy.upa-coart.workers.dev',

    // ------------------------------------------------------------------
    // Solo se usa cuando PROXY_URL esta vacio (desarrollo local)
    // ------------------------------------------------------------------
    URL: env.PUBLIC_WC_URL ?? 'https://lupaecoart.local',
    CONSUMER_KEY: env.PUBLIC_WC_CONSUMER_KEY ?? '',
    CONSUMER_SECRET: env.PUBLIC_WC_CONSUMER_SECRET ?? '',

    // ------------------------------------------------------------------
    // Modo boceto: mientras no haya backend configurado, muestra productos
    // de ejemplo (demo-data.js). Se apaga solo al completar PROXY_URL.
    // ------------------------------------------------------------------
    DEMO: true,

    // ------------------------------------------------------------------
    // WhatsApp de la tienda para "Coordinar por WhatsApp" (solo digitos,
    // con codigo de pais, sin + ni espacios). Ej: '59899123456'.
    // Vacio = no se muestra el boton de WhatsApp al confirmar el pedido.
    // ------------------------------------------------------------------
    WHATSAPP_NUMBER: env.PUBLIC_WC_WHATSAPP ?? '59894319604'
};

// ==========================================
// ENTORNO
// ==========================================

// true cuando el sitio corre en la maquina de desarrollo.
export const WC_IS_LOCAL_DEV =
    ['localhost', '127.0.0.1', '::1', ''].includes(location.hostname) ||
    location.hostname.endsWith('.local');

// Los datos de ejemplo solo se piden si todavia no hay PROXY_URL. El import
// dinamico los deja en un chunk aparte que en produccion nunca se descarga.
let wcDemoResponse = null;
if (WC_CONFIG.DEMO && !WC_CONFIG.PROXY_URL) {
    ({ wcDemoResponse } = await import('./demo-data.js'));
}

// ==========================================
// HELPERS
// ==========================================

// Arma la URL de un endpoint de la WooCommerce REST API.
export function wcApiUrl(endpoint, params = {}) {
    let url;

    if (WC_CONFIG.PROXY_URL) {
        // Produccion: el Worker maneja las API keys
        url = new URL(`${WC_CONFIG.PROXY_URL}/${endpoint}`);
    } else {
        // Desarrollo local: keys en query string (solo localhost)
        url = new URL(`${WC_CONFIG.URL}/wp-json/wc/v3/${endpoint}`);
        url.searchParams.set('consumer_key', WC_CONFIG.CONSUMER_KEY);
        url.searchParams.set('consumer_secret', WC_CONFIG.CONSUMER_SECRET);
    }

    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            url.searchParams.set(key, value);
        }
    });
    return url.toString();
}

// true si todavia no hay backend configurado.
export function wcBackendMissing() {
    return !WC_CONFIG.PROXY_URL && !WC_CONFIG.CONSUMER_KEY;
}

// true si hay que usar los productos de ejemplo (sin backend configurado).
export function wcDemoMode() {
    return WC_CONFIG.DEMO && wcBackendMissing() && typeof wcDemoResponse === 'function';
}

// Pide un endpoint y devuelve el JSON. Lanza si la API falla.
export async function wcFetchJson(endpoint, params = {}) {
    if (wcDemoMode()) return wcDemoResponse(endpoint, params);
    if (wcBackendMissing()) throw new Error('PROXY_URL sin configurar');

    const res = await fetch(wcApiUrl(endpoint, params));
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`WooCommerce API respondió ${res.status}: ${body}`);
    }
    return res.json();
}

// Estado de error visible para el cliente.
// Un cliente real no tiene que ver un producto inventado.
export function wcRenderError(containerId, err) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const sinBackend = wcBackendMissing();
    const titulo = sinBackend
        ? 'Tienda en configuracion'
        : 'No pudimos cargar los productos';
    const texto = sinBackend
        ? 'Estamos terminando de conectar el catalogo. Volve en un rato.'
        : 'Hubo un problema al contactar la tienda. Reintenta en unos minutos.';

    container.innerHTML = `
        <div class="col-span-full flex flex-col items-center justify-center text-center py-16 px-4">
            <svg class="w-12 h-12 text-primary-300 mb-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round"
                      d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"/>
            </svg>
            <h3 class="text-lg font-semibold text-black mb-1">${titulo}</h3>
            <p class="text-sm text-neutral-500 max-w-sm">${texto}</p>
            <button onclick="location.reload()"
                    class="mt-5 px-5 py-2 bg-primary-700 hover:bg-primary-800 text-white text-sm font-semibold rounded-full transition">
                Reintentar
            </button>
        </div>
    `;

    // El detalle tecnico queda solo en consola, no en pantalla.
    if (err) console.error(`[LupaEcoart] ${containerId}:`, err);
}

// Unidades que se pueden comprar de un producto de WooCommerce. El unico
// limite es el stock real: 0 si esta agotado, la cantidad cargada si
// "Gestionar inventario" esta activo (y no acepta reservas), 1 si se vende
// individualmente, y sin tope (Infinity) si WooCommerce no lleva la cuenta.
export function wcStockLimit(p) {
    if (!p || p.stock_status === 'outofstock' || p.purchasable === false) return 0;
    let limit = Infinity;
    if (p.manage_stock && !p.backorders_allowed && p.stock_quantity !== null && p.stock_quantity !== undefined) {
        limit = Math.max(0, parseInt(p.stock_quantity, 10) || 0);
    }
    if (p.sold_individually) limit = Math.min(limit, 1);
    return limit;
}

// Texto comparable para busquedas: minusculas, sin tildes y sin espacios sobrantes.
// Asi "laser" encuentra "Corte láser" y "Laptop " encuentra "Soporte Laptop".
// Marcas diacriticas combinantes (U+0300 a U+036F) que quedan tras normalize('NFD').
const WC_DIACRITICS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');

export function wcNormalize(text) {
    return String(text || '')
        .normalize('NFD')
        .replace(WC_DIACRITICS, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

// Formatea precios en pesos uruguayos.
export function wcPrice(value) {
    const n = Number(value);
    if (!isFinite(n)) return '$ 0';
    return `$ ${n.toLocaleString('es-UY', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

// Aviso discreto cuando se ven datos de ejemplo.
document.addEventListener('DOMContentLoaded', () => {
    if (!wcDemoMode()) return;
    const tag = document.createElement('div');
    tag.className = 'fixed bottom-4 left-4 z-50 bg-white/95 text-primary-800 text-xs font-semibold px-3 py-1.5 rounded-full shadow-lg border border-primary-100';
    tag.textContent = 'Boceto · productos de ejemplo';
    document.body.appendChild(tag);
});

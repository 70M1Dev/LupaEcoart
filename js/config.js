// ==========================================
// CONFIGURACION — Lupa Ecoart
// ==========================================
// Este archivo ES PUBLICO (se sube a GitHub y se sirve al navegador).
// NUNCA pongas aca las API keys de WooCommerce.
//
// Arquitectura:
//
//   Navegador
//      ├─ Frontend estatico  → GitHub Pages / Hostinger  (estos HTML)
//      └─ PROXY_URL          → Cloudflare Worker (worker.js)
//                                  └─ agrega las API keys
//                                     y le pega a WordPress + WooCommerce
//
// El navegador nunca ve las credenciales: viven como secrets en Cloudflare.
// ==========================================

const WC_CONFIG = {
    // ------------------------------------------------------------------
    // ⚙️  UNICO VALOR A CAMBIAR AL DEPLOYAR
    // ------------------------------------------------------------------
    // URL del Cloudflare Worker que hace de proxy. Sin barra final.
    //
    //   Con dominio propio:  https://api.lupaecoart.com
    //   Sin dominio (gratis): https://lupaecoart-wc-proxy.<tu-subdominio>.workers.dev
    //
    // Dejalo en '' para pegarle directo a WordPress (solo desarrollo local).
    // Worker ya deployado: https://lupaecoart-wc-proxy.upa-coart.workers.dev
    // Queda vacio (modo boceto) hasta que la tienda tenga productos cargados.
    PROXY_URL: '',

    // ------------------------------------------------------------------
    // Solo se usa cuando PROXY_URL esta vacio (desarrollo local)
    // ------------------------------------------------------------------
    URL: 'https://lupaecoart.local',
    CONSUMER_KEY: '',
    CONSUMER_SECRET: '',

    // ------------------------------------------------------------------
    // Modo boceto: mientras no haya backend configurado, muestra productos
    // de ejemplo (js/demo-data.js). Se apaga solo al completar PROXY_URL.
    // ------------------------------------------------------------------
    DEMO: true
};

// ==========================================
// OVERRIDE DE DESARROLLO
// ==========================================
// js/config.local.js esta gitignored y solo existe en la maquina de desarrollo.
// Lo pedimos unicamente cuando el sitio corre en local, asi en produccion
// no queda un 404 colgado en la consola.

const WC_IS_LOCAL_DEV =
    ['localhost', '127.0.0.1', '::1', ''].includes(location.hostname) ||
    location.hostname.endsWith('.local');

if (WC_IS_LOCAL_DEV) {
    document.write('<script src="js/config.local.js"><\/script>');
}

// Los datos de ejemplo solo se piden si todavia no hay PROXY_URL.
if (WC_CONFIG.DEMO && !WC_CONFIG.PROXY_URL) {
    document.write('<script src="js/demo-data.js"><\/script>');
}

// ==========================================
// HELPERS
// ==========================================

// Arma la URL de un endpoint de la WooCommerce REST API.
function wcApiUrl(endpoint, params = {}) {
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
function wcBackendMissing() {
    return !WC_CONFIG.PROXY_URL && !WC_CONFIG.CONSUMER_KEY;
}

// true si hay que usar los productos de ejemplo (sin backend configurado).
function wcDemoMode() {
    return WC_CONFIG.DEMO && wcBackendMissing() && typeof wcDemoResponse === 'function';
}

// Pide un endpoint y devuelve el JSON. Lanza si la API falla.
async function wcFetchJson(endpoint, params = {}) {
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
function wcRenderError(containerId, err) {
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
            <svg class="w-12 h-12 text-primary-200 mb-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round"
                      d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"/>
            </svg>
            <h3 class="text-lg font-semibold text-black mb-1">${titulo}</h3>
            <p class="text-sm text-neutral-500 max-w-sm">${texto}</p>
            <button onclick="location.reload()"
                    class="mt-5 px-5 py-2 bg-primary-800 hover:bg-primary-600 text-white text-sm font-semibold rounded-full transition">
                Reintentar
            </button>
        </div>
    `;

    // El detalle tecnico queda solo en consola, no en pantalla.
    if (err) console.error(`[LupaEcoart] ${containerId}:`, err);
}

// Formatea precios en pesos uruguayos.
function wcPrice(value) {
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

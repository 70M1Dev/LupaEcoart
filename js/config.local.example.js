// ==========================================
// CONFIGURACION LOCAL — Template
// ==========================================
// Copia este archivo como js/config.local.js y completa con las keys
// de tu WooCommerce local (LocalWP).
//
//   cp js/config.local.example.js js/config.local.js
//
// js/config.local.js esta en .gitignore y NUNCA se sube a GitHub.
// Solo se carga cuando el sitio corre en localhost o *.local
// (ver js/config.js), asi que en produccion no existe ni hace falta.
// ==========================================

// Sobrescribe la config de produccion definida en js/config.js
WC_CONFIG.PROXY_URL = '';                       // vacio = pegarle directo a WordPress
WC_CONFIG.URL = 'https://lupaecoart.local';     // URL del sitio en LocalWP
WC_CONFIG.CONSUMER_KEY = 'ck_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
WC_CONFIG.CONSUMER_SECRET = 'cs_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

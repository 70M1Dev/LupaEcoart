# Lupa Ecoart — Tienda Online con WooCommerce

Frontend estático hecho con **Astro + Tailwind CSS** que consume la
**WooCommerce REST API** para mostrar productos, carrito y checkout.

## 🏗️ Arquitectura

```
Navegador
   │
   ├── GitHub Pages ──────────► HTML/CSS/JS estático (build de Astro)
   │
   └── Cloudflare Worker ─────► WordPress + WooCommerce
       (agrega las API keys)     (/wp-json/wc/v3/…)
```

El frontend **nunca** ve las credenciales de WooCommerce: le pega al Worker,
y el Worker las agrega del lado del servidor.

```
astro.config.mjs         ← Config de Astro (build estático, Tailwind)
.env.example             ← Template de variables para desarrollo local
.env                     ← [GITIGNORED] Keys reales para desarrollo
worker.js                ← Cloudflare Worker (proxy de la API)
wrangler.toml            ← Config de deploy del Worker
.github/workflows/
└── deploy.yml           ← Compila el sitio y lo publica en GitHub Pages

src/
├── pages/               ← Una página por archivo; el nombre es la URL
│   ├── index.astro      ← Home con productos destacados
│   ├── productos.astro  ← Catálogo con filtros (categoría, precio, búsqueda, orden)
│   ├── producto.astro   ← Detalle de producto con galería + medidas
│   ├── carrito.astro    ← Carrito con cupones (localStorage)
│   ├── checkout.astro   ← Formulario de checkout
│   └── admin.astro      ← Panel de tienda (stock, altas y edición de productos)
├── layouts/
│   └── BaseLayout.astro ← Head común + scripts de UI compartidos
├── components/          ← Lo que se repite en varias páginas
│   ├── Navbar.astro     ← Navbar desktop (con la sección activa por prop)
│   ├── MenuToggle.astro ← Botón hamburguesa
│   ├── Drawer.astro     ← Navegación lateral mobile
│   └── Footer.astro
├── styles/
│   ├── global.css       ← Paleta, tipografía y compatibilidad con Tailwind v3
│   └── admin.css        ← Clases del panel (.card, .input, .btn-primary…)
└── scripts/
    ├── config.js        ← Config de producción (pública, sin secretos)
    ├── categories.js    ← Slugs y nombres de las categorías
    ├── demo-data.js     ← Productos de ejemplo (solo modo boceto)
    ├── ui.js            ← Drawer mobile + navbar inteligente
    ├── cart.js          ← Carrito compartido (localStorage)
    ├── index.js         ← Carga productos destacados
    ├── productos.js     ← Lista con filtros
    ├── producto.js      ← Detalle + productos relacionados
    ├── carrito.js       ← Carrito + cupones
    ├── checkout.js      ← Pedidos reales con la Store API
    └── admin-globals.js ← Puente de config para public/js/admin.js

public/                  ← Se copia tal cual a la raíz del sitio
├── assets/logo.svg      ← Logo (lupa + hoja)
├── js/admin.js          ← Panel de tienda (script clásico, sin bundlear)
└── CNAME
```

### Cómo se agrega una página nueva

Un archivo en `src/pages/` alcanza: `src/pages/contacto.astro` se publica en
`/contacto`. Lo de siempre (head, fuentes, estilos, drawer) ya viene del layout:

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import Navbar from '../components/Navbar.astro';
import Footer from '../components/Footer.astro';
---

<BaseLayout title="Contacto">
    <Navbar />
    <!-- contenido -->
    <Footer />
</BaseLayout>
```

## 🧰 Panel de tienda (`/admin`)

`https://lupaecoart.site/admin` — la dueña de la tienda entra con su **usuario de
WordPress** y una **contraseña de aplicación** y desde ahí:

- ve el catálogo completo (publicados y borradores) con buscador y filtros;
- cambia el stock en el momento (disponible / agotado / cantidad);
- crea productos nuevos y edita los existentes: fotos (se achican solas a
  1600 px), nombre, categoría, descripción, precio, oferta, medidas,
  publicado y destacado;
- elimina productos (van a la papelera de WordPress, se pueden recuperar).

Cómo funciona: el panel le pega al Worker en `/admin/…` con la contraseña de
aplicación, y el Worker la reenvía a WordPress **sin agregar las API keys**. Así
WooCommerce aplica los permisos del usuario (rol *Gestor de tienda*). No hay
ninguna clave de escritura guardada en el navegador, en GitHub ni en Cloudflare.

Los cambios se ven en la tienda en hasta 5 minutos (caché del Worker).

Configuración inicial: ver **Paso 7** en `DEPLOY.md`.

**Modo prueba local:** `http://localhost:4321/admin?demo` trabaja en memoria con
los productos de `src/scripts/demo-data.js` (cualquier usuario entra, no toca la
tienda).

El panel es el único que sigue siendo un script clásico sin bundlear
(`public/js/admin.js`): `src/scripts/admin-globals.js` le deja la config en el
scope global y recién entonces lo carga. Si se lo edita, hay que subir el `?v=`
de `src/pages/admin.astro` para saltear la caché del navegador.

## 🎨 Identidad

- Color principal: `#8F9B2F` (`primary-500`; escala `primary-50` … `primary-900` definida en `src/styles/global.css`)
- Secundarios: naranja `#FCA321` (`accent`), crema `#E6EBB1` (`cream`), verde agua `#7ABFB1` (`teal`), mostaza `#A68A26` (`mustard`)
- Fondos de texto blancos, texto negro; texto blanco sobre zonas oscuras
- Botones con texto blanco en `primary-700` (oliva oscuro) para que el texto se lea bien
- Tipografía: Outfit (Google Fonts)
- Categorías (slugs de WooCommerce): `papeleria`, `corte-laser`, `personalizados`, `reciclables`, `otros` (definidas en `WC_CATEGORIES`, `src/scripts/categories.js`)

## 👀 Modo boceto

Mientras `PROXY_URL` esté vacío y no haya keys locales, `src/scripts/config.js`
carga `src/scripts/demo-data.js` y muestra productos de ejemplo (con un aviso
abajo a la izquierda). Al configurar el backend se apaga solo. Para desactivarlo
antes: `DEMO: false`.

## 🖥️ Desarrollo local

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # compila a dist/
npm run preview    # sirve dist/ como lo hará GitHub Pages
```

Para trabajar contra un WordPress local:

1. Levantá el sitio de WordPress en **LocalWP** (`lupaecoart.local`).
2. En WordPress: **WooCommerce → Ajustes → Avanzado → REST API** → crear una clave
   con permisos de **Lectura**.
3. Copiá el template y pegá tus keys:

   ```bash
   cp .env.example .env
   ```

`.env` está en `.gitignore` y nunca se sube. Ojo: todo lo que empieza con
`PUBLIC_` termina en el bundle que ve el navegador, así que ahí van solo las
keys del WordPress local, nunca las de producción (esas viven como secrets del
Worker).

### CORS en el WordPress local

Si el frontend corre en otro puerto que WordPress, agregá esto a `functions.php`
del tema (o a un plugin tipo *Code Snippets*):

```php
add_action('rest_api_init', function () {
    remove_filter('rest_pre_serve_request', 'rest_send_headers');
    add_filter('rest_pre_serve_request', function ($value) {
        header('Access-Control-Allow-Origin: *');
        header('Access-Control-Allow-Methods: GET, OPTIONS');
        return $value;
    });
}, 1);
```

En producción esto **no hace falta**: el Worker ya devuelve los headers de CORS.

## 🌐 Deploy

### 1. Frontend → GitHub Pages

El sitio se compila, así que Pages tiene que servir el build en vez de los
archivos del repo. Una sola vez, en GitHub:

**Settings → Pages → Source: GitHub Actions**

Después, cada `git push` a `main` dispara `.github/workflows/deploy.yml`, que
corre `npm ci && npm run build` y publica `dist/`.

### 2. Proxy de la API → Cloudflare Workers

```bash
npm install -g wrangler
wrangler login
wrangler secret put WC_BASE_URL          # ej: https://tienda.lupaecoart.com
wrangler secret put WC_CONSUMER_KEY      # ck_…
wrangler secret put WC_CONSUMER_SECRET   # cs_…
wrangler secret put ALLOWED_ORIGINS      # ej: https://70m1dev.github.io,https://lupaecoart.com
wrangler deploy
```

Después de deployar, poné la URL del Worker en `PROXY_URL` dentro de
`src/scripts/config.js` y hacé push.

El Worker:

- en la zona pública solo acepta `GET` y solo deja pasar `/products`,
  `/products/{id}` y `/products/categories` (nadie puede leer órdenes ni
  clientes a través del proxy);
- ignora `consumer_key` / `consumer_secret` que mande el cliente;
- cachea 5 minutos en el edge la zona pública;
- en `/admin/…` exige usuario + contraseña de aplicación, no usa las API keys,
  no cachea, rechaza orígenes fuera de `ALLOWED_ORIGINS` y solo permite
  productos, categorías, subida de fotos y `/me`;
- responde CORS solo a los orígenes de `ALLOWED_ORIGINS`.

### 3. WordPress

WordPress **no** va en GitHub Pages — necesita PHP y MySQL, así que vive en un
hosting aparte. El frontend solo le habla por la REST API a través del Worker.

## 🔒 Seguridad

- Las keys de WooCommerce viven únicamente como **secrets de Cloudflare**.
- `.env` está en `.gitignore`; si alguna vez se subió una key, hay que
  **regenerarla** desde WooCommerce, no alcanza con borrar el archivo.
- Usá una clave de API con permisos de **solo lectura**.

## 🛒 Estado del checkout

El carrito funciona con `localStorage`. El checkout está **simulado**: valida el
formulario y muestra la confirmación, pero todavía no crea la orden en WooCommerce.
Para hacerlo real hace falta un endpoint `POST /orders`, que requiere una clave de
escritura y por lo tanto tiene que resolverse dentro del Worker (no desde el navegador).

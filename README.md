# Lupa Ecoart — Tienda Online con WooCommerce

Frontend estático (HTML + Tailwind CSS) que consume la **WooCommerce REST API** para mostrar productos, carrito y checkout.

## 🏗️ Arquitectura

```
Navegador
   │
   ├── GitHub Pages ──────────► HTML/CSS/JS estático (este repo)
   │
   └── Cloudflare Worker ─────► WordPress + WooCommerce
       (agrega las API keys)     (/wp-json/wc/v3/…)
```

El frontend **nunca** ve las credenciales de WooCommerce: le pega al Worker,
y el Worker las agrega del lado del servidor.

```
index.html               ← Home con productos destacados
productos.html           ← Catálogo con filtros (categoría, precio, búsqueda, orden)
producto.html            ← Detalle de producto con galería + medidas
carrito.html             ← Carrito con cupones (localStorage)
checkout.html            ← Formulario de checkout
admin.html               ← Panel de tienda (stock, altas y edición de productos)
assets/logo.svg          ← Logo (lupa + hoja)
worker.js                ← Cloudflare Worker (proxy de la API)
wrangler.toml            ← Config de deploy del Worker
js/
├── config.js            ← Config de producción (pública, sin secretos)
├── config.local.example.js ← Template para desarrollo local
├── config.local.js      ← [GITIGNORED] Keys reales para desarrollo
├── demo-data.js         ← Productos de ejemplo (solo boceto local)
├── cart.js              ← Carrito compartido (localStorage)
├── index.js             ← Carga productos destacados
├── productos.js         ← Lista con filtros
├── producto.js          ← Detalle + productos relacionados
├── carrito.js           ← Carrito + cupones
├── checkout.js          ← Formulario de checkout (simulado)
└── admin.js             ← Panel de tienda
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

**Modo prueba local:** `http://localhost:…/admin?demo` trabaja en memoria con
los productos de `js/demo-data.js` (cualquier usuario entra, no toca la tienda).

## 🎨 Identidad

- Color principal: `#8F9B2F` (`primary-500`; escala `primary-50` … `primary-900` en el `tailwind.config` de cada HTML)
- Secundarios: naranja `#FCA321` (`accent`), crema `#E6EBB1` (`cream`), verde agua `#7ABFB1` (`teal`), mostaza `#A68A26` (`mustard`)
- Fondos de texto blancos, texto negro; texto blanco sobre zonas oscuras
- Botones con texto blanco en `primary-700` (oliva oscuro) para que el texto se lea bien
- Tipografía: Outfit (Google Fonts)
- Categorías (slugs de WooCommerce): `papeleria`, `corte-laser`, `personalizados`, `reciclables`, `otros` (definidas en `WC_CATEGORIES`, `js/config.js`)

## 👀 Modo boceto

Mientras `PROXY_URL` esté vacío y no haya keys locales, `js/config.js` carga
`js/demo-data.js` y muestra productos de ejemplo (con un aviso abajo a la izquierda).
Al configurar el backend se apaga solo. Para desactivarlo antes: `DEMO: false`.

## 🖥️ Desarrollo local

1. Levantá el sitio de WordPress en **LocalWP** (`lupaecoart.local`).
2. En WordPress: **WooCommerce → Ajustes → Avanzado → REST API** → crear una clave
   con permisos de **Lectura**.
3. Copiá el template y pegá tus keys:

   ```bash
   cp js/config.local.example.js js/config.local.js
   ```

4. Abrí `index.html` con Live Server (o cualquier servidor local).

`js/config.local.js` solo se carga cuando el sitio corre en `localhost`, `127.0.0.1`
o un dominio `.local` (ver el bloque de override en `js/config.js`). En producción
ni se pide, así que no ensucia la consola con un 404.

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

El repo publica desde la rama `main`, carpeta raíz.
En GitHub: **Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)`**.

Cada `git push` a `main` republica el sitio.

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

Después de deployar, poné la URL del Worker en `PROXY_URL` dentro de `js/config.js`
y hacé push.

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
- `js/config.local.js` está en `.gitignore`; si alguna vez se subió una key, hay
  que **regenerarla** desde WooCommerce, no alcanza con borrar el archivo.
- Usá una clave de API con permisos de **solo lectura**.

## 🛒 Estado del checkout

El carrito funciona con `localStorage`. El checkout está **simulado**: valida el
formulario y muestra la confirmación, pero todavía no crea la orden en WooCommerce.
Para hacerlo real hace falta un endpoint `POST /orders`, que requiere una clave de
escritura y por lo tanto tiene que resolverse dentro del Worker (no desde el navegador).

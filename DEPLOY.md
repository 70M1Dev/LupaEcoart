# Deploy — Lupa Ecoart

## Arquitectura

```
                      ┌─────────────────────────────┐
   Cliente ──────────►│ FRONTEND (estatico)         │
                      │ GitHub Pages o Hostinger    │
                      │ index.html, js/, assets/    │
                      └──────────────┬──────────────┘
                                     │ fetch(PROXY_URL/products)
                                     ▼
                      ┌─────────────────────────────┐
                      │ CLOUDFLARE WORKER (gratis)  │
                      │ worker.js                   │
                      │ agrega ck_/cs_ del lado     │
                      │ del servidor                │
                      └──────────────┬──────────────┘
                                     │ /wp-json/wc/v3/products
                                     ▼
                      ┌─────────────────────────────┐
                      │ WORDPRESS + WOOCOMMERCE     │
                      │ Hostinger (PHP + MySQL)     │
                      │ productos, stock, PayPal    │
                      └─────────────────────────────┘
```

El navegador **nunca** ve las API keys de WooCommerce. Viven como secrets en
Cloudflare y solo el Worker las usa.

---

## Paso 1 — Hostinger: instalar WordPress

En hPanel:

1. **Sitios web → Agregar sitio web → WordPress**.
2. Instalalo en un subdominio dedicado, por ejemplo `tienda.tudominio.com`.
   Asi el dominio raiz queda libre para el frontend estatico.
3. Durante la instalacion, elegi instalar **WooCommerce**.
4. Activa **SSL** (hPanel → Seguridad → SSL). La REST API tiene que ir por HTTPS.

> El tema de WordPress da igual: el cliente nunca lo ve. El frontend es el HTML
> de este repo.

## Paso 2 — Migrar los productos desde LocalWP

No hace falta mover los 385 MB del sitio local: los plugins se reinstalan y el
tema no se usa. Los datos reales son los productos y las imagenes.

**En LocalWP** (arranca el sitio `lupaecoart`):

1. `WooCommerce → Productos → Exportar` → *Generar CSV* (exporta todas las columnas).
2. `wp-content/uploads/` → comprimi la carpeta (son ~1.9 MB).

**En Hostinger:**

3. Subi el contenido de `uploads/` por el Administrador de archivos a
   `public_html/tienda/wp-content/uploads/` respetando la estructura `2025/08/…`.
4. `WooCommerce → Productos → Importar` → subi el CSV.
5. Instala y configura **WooCommerce PayPal Payments** con las credenciales de
   tu cuenta PayPal Business.
6. Revisa `WooCommerce → Ajustes → General`: moneda **UYU**, pais Uruguay.

## Paso 3 — Crear la API key de lectura

En Hostinger, dentro de WordPress:

1. `WooCommerce → Ajustes → Avanzado → REST API → Crear una clave`.
2. Descripcion: `Lupa Ecoart Frontend`, Usuario: tu admin, Permisos: **Lectura**.
3. Copia el `Consumer key` (`ck_…`) y el `Consumer secret` (`cs_…`).
   Se muestran **una sola vez**.

> Permisos de solo lectura. Si alguna vez se filtran, nadie puede modificar la
> tienda con ellas.

## Paso 4 — Deployar el Worker en Cloudflare

Requiere Node.js instalado.

```bash
npm install -g wrangler
wrangler login

wrangler secret put WC_BASE_URL          # https://tienda.tudominio.com   (sin barra final)
wrangler secret put WC_CONSUMER_KEY      # ck_...
wrangler secret put WC_CONSUMER_SECRET   # cs_...
wrangler secret put ALLOWED_ORIGINS      # https://70m1dev.github.io,https://tudominio.com

wrangler deploy
```

`wrangler deploy` imprime la URL del Worker
(`https://lupaecoart-wc-proxy.<algo>.workers.dev`).

**Alternativa sin Node:** Cloudflare Dashboard → *Workers & Pages* → *Create
Worker* → pega el contenido de `worker.js` → *Settings → Variables* → agrega las
4 variables como **Secret**.

Probalo:

```bash
curl "https://lupaecoart-wc-proxy.<algo>.workers.dev/products?per_page=1"
```

## Paso 5 — Conectar el frontend

En `js/config.js`, poné la URL del Worker:

```javascript
PROXY_URL: 'https://lupaecoart-wc-proxy.<algo>.workers.dev',
```

Y publicá:

```bash
git add js/config.js && git commit -m "Conecta el frontend al Worker" && git push
```

### Frontend en GitHub Pages (ya activo)

https://70m1dev.github.io/LupaEcoart/ — se republica solo en cada push a `main`.

### Frontend en Hostinger (opcional, para usar el dominio raiz)

hPanel → **Avanzado → Git**:

- Repositorio: `https://github.com/70M1Dev/LupaEcoart.git`
- Rama: `main`
- Directorio: `public_html`

Despues *Deploy*. Con el webhook activado, cada push se publica solo.
No hace falta darle a nadie credenciales FTP.

## Paso 6 — Dominio en Cloudflare (cuando lo tengas)

1. Cloudflare → *Add a site* → tu dominio.
2. Cloudflare te da 2 nameservers → cargalos en Hostinger
   (hPanel → Dominios → DNS / Nameservers).
3. Registros DNS:

   | Tipo | Nombre | Contenido | Proxy |
   |---|---|---|---|
   | A | `tienda` | IP de Hostinger | 🟠 |
   | A / CNAME | `@` | Hostinger, o GitHub Pages | 🟠 |
   | Worker route | `api` | `lupaecoart-wc-proxy` | — |

4. Descomenta el bloque `[[routes]]` de `wrangler.toml`, corre `wrangler deploy`
   y actualiza `PROXY_URL` a `https://api.tudominio.com`.

---

## Checklist

- [ ] WordPress instalado en `tienda.tudominio.com` con SSL
- [ ] WooCommerce instalado y moneda en UYU
- [ ] Productos importados por CSV + imagenes subidas
- [ ] PayPal configurado
- [ ] API key de **lectura** creada
- [ ] Worker deployado con los 4 secrets
- [ ] `curl` al Worker devuelve JSON de productos
- [ ] `PROXY_URL` actualizado en `js/config.js` y pusheado
- [ ] `ALLOWED_ORIGINS` incluye el dominio real del frontend
- [ ] Keys viejas de LocalWP **revocadas** en WooCommerce

## Pendiente de desarrollo

El checkout esta **simulado**: valida el formulario y muestra la confirmacion,
pero no crea la orden en WooCommerce. Para cobrar de verdad hacen falta dos
cosas, y ninguna puede vivir en el navegador:

1. Un `POST /orders` hecho desde el Worker con una key de **escritura**.
2. Redirigir al cliente al checkout de WooCommerce para que PayPal procese el
   pago, o integrar la PayPal JS SDK contra la orden ya creada.

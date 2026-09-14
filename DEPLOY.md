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

### Ajustes de WordPress en Hostinger

- `Ajustes → Enlaces permanentes` → **Nombre de la entrada**. Con "Simple" la
  ruta `/wp-json/` no funciona y la API devuelve 404.
- Si esta activo **LiteSpeed Cache**, dejá sin tildar "Cachear REST API"
  (el Worker ya cachea 5 minutos).
- Probá que la API responde abriendo `https://tienda.tudominio.com/wp-json/`
  (tiene que mostrar JSON). Mientras no haya dominio sirve el dominio temporal
  de Hostinger (`*.hostingersite.com`), siempre con **https**.

## Paso 2 — Configurar la tienda

1. `WooCommerce → Ajustes → General`: moneda **UYU**, país Uruguay.
2. `Productos → Categorías`: crear estas categorías con el **slug exacto**
   (el frontend filtra por slug):

   | Nombre | Slug |
   |---|---|
   | Papelería | `papeleria` |
   | Corte láser | `corte-laser` |
   | Personalizados | `personalizados` |
   | Reciclables | `reciclables` |
   | Otros | `otros` |

3. `Productos → Atributos`: crear el atributo **Medida** (lo usan los productos
   que se venden en varios tamaños).
4. `Usuarios → Añadir nuevo`: crear el usuario del cliente con rol
   **Gestor de tienda** (carga productos y stock sin acceso a plugins).
5. Cargar 2 o 3 productos de prueba con foto, precio y categoría. Marcar alguno
   con ⭐ **Destacado** para que aparezca en el inicio.
6. Pagos: instalar **Mercado Pago** o **WooCommerce PayPal Payments** cuando el
   checkout se conecte (ver *Pendiente de desarrollo*).

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

## Paso 7 — Panel de tienda (`/admin`)

1. **Usuario de la dueña**: `Usuarios → Añadir nuevo`, rol **Gestor de tienda**
   (si ya existe, revisá el rol).
2. **Contraseña de aplicación**: entrá a WordPress *con ese usuario* →
   `Usuarios → Perfil` → abajo de todo, *Contraseñas de aplicación* → nombre
   `Panel Lupa Ecoart` → **Añadir**. Copiá la clave (24 letras en grupos de 4):
   se muestra **una sola vez**. Esa es la "contraseña" del panel.
   Para quitarle el acceso a un dispositivo, se revoca desde la misma pantalla.
3. **Worker**: `ALLOWED_ORIGINS` tiene que incluir el dominio del panel
   (`https://lupaecoart.site`). Después `wrangler deploy` para publicar las
   rutas `/admin/…`.
4. Entrá a `https://lupaecoart.site/admin` y probá.

### Si el login dice "WordPress no reconoció la clave"

Con usuario y clave correctos, eso significa que el hosting le está sacando el
header `Authorization` a PHP. En Hostinger → Administrador de archivos →
`.htaccess` de WordPress, agregá **arriba** del bloque `# BEGIN WordPress`:

```apache
<IfModule mod_rewrite.c>
RewriteEngine On
RewriteRule .* - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]
</IfModule>
SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1
```

Si hay algún plugin de seguridad (Wordfence, iThemes, etc.), revisá que no tenga
desactivadas las contraseñas de aplicación o la REST API.

---

## Checklist

- [ ] WordPress instalado en Hostinger con SSL
- [ ] Enlaces permanentes en "Nombre de la entrada" y `/wp-json/` responde JSON
- [ ] WooCommerce instalado y moneda en UYU
- [ ] Categorías creadas con los slugs `papeleria`, `corte-laser`, `personalizados`, `reciclables`, `otros`
- [ ] Atributo **Medida** creado
- [ ] Usuario del cliente con rol **Gestor de tienda**
- [ ] Productos de prueba cargados (alguno destacado)
- [ ] API key de **lectura** creada
- [ ] Worker deployado con los 4 secrets
- [ ] `curl` al Worker devuelve JSON de productos
- [ ] `PROXY_URL` actualizado en `js/config.js` y pusheado (apaga el modo boceto)
- [ ] `ALLOWED_ORIGINS` incluye el dominio real del frontend
- [ ] Contraseña de aplicación creada para el usuario *Gestor de tienda*
- [ ] Worker redeployado con las rutas `/admin/…`
- [ ] Login en `/admin` funciona y se puede cambiar el stock de un producto

## Pendiente de desarrollo

El checkout esta **simulado**: valida el formulario y muestra la confirmacion,
pero no crea la orden en WooCommerce. Para cobrar de verdad hacen falta dos
cosas, y ninguna puede vivir en el navegador:

1. Un `POST /orders` hecho desde el Worker con una key de **escritura**.
2. Redirigir al cliente al checkout de WooCommerce para que PayPal procese el
   pago, o integrar la PayPal JS SDK contra la orden ya creada.

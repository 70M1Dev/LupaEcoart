// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
    site: 'https://lupaecoart.site',

    // `file` genera /productos.html en vez de /productos/index.html: GitHub Pages
    // lo sirve igual en /productos, asi que las URLs actuales siguen funcionando.
    build: { format: 'file' },
    trailingSlash: 'never',

    vite: {
        plugins: [tailwindcss()]
    }
});

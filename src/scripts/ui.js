// ==========================================
// UI COMPARTIDA — Lupa Ecoart
// ==========================================
// Drawer mobile y navbar inteligente. Antes estaban copiados en el <script>
// inline de cada HTML y al final de producto.js, carrito.js y productos.js.
// El layout los inicializa una sola vez: las dos funciones no hacen nada si la
// pagina no tiene los elementos correspondientes (checkout y el panel, por ej).
// ==========================================

// Drawer lateral de navegacion en mobile: lo abre y cierra <MenuToggle />.
export function setupDrawer() {
    const toggle = document.getElementById('menu-toggle');
    const drawer = document.getElementById('drawer');
    const overlay = document.getElementById('drawer-overlay');
    if (!toggle || !drawer || !overlay) return;

    const iconHamburger = document.getElementById('icon-hamburger');
    const iconClose = document.getElementById('icon-close');

    function open() {
        drawer.classList.remove('translate-x-full');
        overlay.classList.remove('hidden');
        setTimeout(() => overlay.classList.add('opacity-100'), 10);
        iconHamburger?.classList.add('hidden');
        iconClose?.classList.remove('hidden');
    }

    function close() {
        drawer.classList.add('translate-x-full');
        overlay.classList.remove('opacity-100');
        setTimeout(() => overlay.classList.add('hidden'), 300);
        iconHamburger?.classList.remove('hidden');
        iconClose?.classList.add('hidden');
    }

    toggle.addEventListener('click', () => {
        if (drawer.classList.contains('translate-x-full')) open();
        else close();
    });

    overlay.addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close();
    });
}

// Navbar inteligente: se oculta al bajar y vuelve a aparecer al subir.
export function setupNavbarScroll() {
    const navbar = document.getElementById('navbar-scroll');
    if (!navbar) return;

    let lastScroll = 0;
    const scrollThreshold = 10; // px minimos para considerar que hubo scroll

    window.addEventListener('scroll', () => {
        const currentScroll = window.pageYOffset;

        // Ignorar scrolls muy chicos
        if (Math.abs(currentScroll - lastScroll) < scrollThreshold) return;

        if (currentScroll > lastScroll && currentScroll > 100) {
            navbar.classList.add('-translate-y-full');
        } else if (currentScroll < lastScroll) {
            navbar.classList.remove('-translate-y-full');
        }

        lastScroll = currentScroll;
    });
}

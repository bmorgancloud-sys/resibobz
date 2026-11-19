/*
 * app.js: router, bottom nav, view rendering.
 * Views are placeholders in Phase 0.
 */
(function () {
  'use strict';

  const ROUTES = {
    new:       { title: 'New',       render: placeholder('Create a receipt or quote.') },
    history:   { title: 'History',   render: placeholder('Past receipts and quotes will appear here.') },
    products:  { title: 'Products',  render: placeholder('Your saved products and services.') },
    customers: { title: 'Customers', render: placeholder('Your saved customers.') },
    settings:  { title: 'Settings',  render: placeholder('Business details, GST rate and numbering.') },
  };
  const DEFAULT_ROUTE = 'new';

  const viewEl = document.getElementById('view');
  const titleEl = document.getElementById('view-title');
  const navLinks = document.querySelectorAll('.bottom-nav a[data-route]');

  function placeholder(text) {
    return (el) => {
      const div = document.createElement('div');
      div.className = 'placeholder';
      div.textContent = text;
      el.replaceChildren(div);
    };
  }

  function currentRoute() {
    const name = location.hash.replace(/^#\/?/, '').split('/')[0];
    return ROUTES[name] ? name : DEFAULT_ROUTE;
  }

  function navigate() {
    const name = currentRoute();
    const route = ROUTES[name];
    titleEl.textContent = route.title;
    document.title = route.title + ' · ResiboBZ';
    navLinks.forEach((a) => {
      const active = a.dataset.route === name;
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    route.render(viewEl);
    window.scrollTo(0, 0);
  }

  async function start() {
    window.addEventListener('hashchange', navigate);
    if (!location.hash) history.replaceState(null, '', '#/' + DEFAULT_ROUTE);
    navigate();

    try {
      await db.ensureDefaults();
    } catch (err) {
      console.error(err);
      viewEl.insertAdjacentHTML('afterbegin',
        '<p class="placeholder" role="alert">Storage is unavailable. Data cannot be saved on this device.</p>');
    }

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch((err) => console.error('SW registration failed', err));
    }
  }

  start();
})();

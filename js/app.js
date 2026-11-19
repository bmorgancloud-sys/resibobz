/*
 * app.js: router, bottom nav, view rendering.
 *
 * Routes are hashes: #/<tab>[/<param>...], e.g. #/products, #/products/new, #/products/12.
 * Each view file registers itself on window.Views[<tab>] = { title, render(ctx) }.
 * ctx = { el, params, setTitle(text) }. render may be async.
 */
(function () {
  'use strict';

  window.Views = window.Views || {};

  const TABS = {
    new:       { title: 'New receipt' },
    history:   { title: 'History' },
    products:  { title: 'Products' },
    customers: { title: 'Customers' },
    settings:  { title: 'Settings' },
  };
  const DEFAULT_TAB = 'new';

  const viewEl = document.getElementById('view');
  const titleEl = document.getElementById('view-title');
  const navLinks = document.querySelectorAll('.bottom-nav a[data-route]');

  let renderSeq = 0;

  function parseHash() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    const tab = TABS[parts[0]] ? parts[0] : DEFAULT_TAB;
    return { tab, params: TABS[parts[0]] ? parts.slice(1) : [] };
  }

  function setTitle(text) {
    titleEl.textContent = text;
    document.title = text + ' · ResiboBZ';
  }

  async function navigate() {
    const seq = ++renderSeq;
    const { tab, params } = parseHash();

    navLinks.forEach((a) => {
      const active = a.dataset.route === tab;
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });

    // Render into a fresh container so a slow, superseded render can't touch the new view.
    const container = document.createElement('div');
    viewEl.replaceChildren(container);
    window.scrollTo(0, 0);

    const view = window.Views[tab];
    const ctx = {
      el: container,
      params,
      setTitle: (t) => { if (seq === renderSeq) setTitle(t); },
    };
    setTitle(TABS[tab].title);

    if (!view) {
      container.append(ui.empty(TABS[tab].placeholder || ''));
      return;
    }
    try {
      await view.render(ctx);
    } catch (err) {
      console.error(err);
      if (seq === renderSeq) {
        container.replaceChildren(ui.h('div', { class: 'placeholder', role: 'alert' },
          'Something went wrong: ' + (err && err.message ? err.message : err)));
      }
    }
  }

  async function start() {
    try {
      await db.ensureDefaults();
    } catch (err) {
      console.error(err);
      document.body.insertBefore(
        ui.h('p', { class: 'banner', role: 'alert' }, 'Storage is unavailable. Data cannot be saved on this device.'),
        viewEl);
    }

    window.addEventListener('hashchange', navigate);
    if (!location.hash) history.replaceState(null, '', '#/' + DEFAULT_TAB);
    navigate();

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch((err) => console.error('SW registration failed', err));
    }
  }

  start();
})();

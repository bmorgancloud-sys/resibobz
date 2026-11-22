/*
 * app.js: router, bottom nav, view rendering.
 *
 * Routes are hashes: #/<tab>[/<param>...], e.g. #/products, #/products/new, #/products/12.
 * Routes with `nav` aren't tabs themselves; they highlight that tab (#/receipt/12 -> History,
 * #/quote/3 -> Quotes).
 * Each view file registers itself on window.Views[<tab>] = { title, render(ctx) }.
 * ctx = { el, params, setTitle(text) }. render may be async.
 */
(function () {
  'use strict';

  window.Views = window.Views || {};

  const TABS = {
    new:       { title: 'New receipt' },
    history:   { title: 'History' },
    quotes:    { title: 'Quotes' },
    products:  { title: 'Products' },
    customers: { title: 'Customers' },
    stats:     { title: 'Stats' },
    settings:  { title: 'Settings' },
    receipt:   { title: 'Receipt', nav: 'history' },
    quote:     { title: 'Quote', nav: 'quotes' },   // #/quote/<id>, #/quote/new, #/quote/<id>/edit
    summary:   { title: 'Daily summary', nav: 'history' }, // #/summary[/YYYY-MM-DD]
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
    document.title = text + ' · Toucan Bill';
  }

  async function navigate() {
    if (appUpdate.reloadIfReady()) return; // a new version is waiting: load it on this route
    const seq = ++renderSeq;
    const { tab, params } = parseHash();

    viewEl.dataset.view = tab; // lets a view widen the page (Stats uses up to 1000px on desktop)
    const navTab = TABS[tab].nav || tab;
    navLinks.forEach((a) => {
      const active = a.dataset.route === navTab;
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

  /** Dev only (tests/seed.html): make it impossible to mistake fake test data for real data. */
  function showTestDbBar() {
    const back = ui.h('button', { type: 'button', class: 'btn btn-small btn-secondary', onclick: () => {
      db.useRealDb();
      location.reload();
    } }, 'Back to real data');
    document.body.insertBefore(ui.h('div', { class: 'banner test-db-bar', role: 'status' },
      ui.h('span', null, 'TEST DATABASE: fake data, not your real receipts.'), back), viewEl);
  }

  async function start() {
    if (db.isTestDb) showTestDbBar();
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

    appUpdate.register();
  }

  start();
})();

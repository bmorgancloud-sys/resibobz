/*
 * update.js: service worker registration and the "Update available, tap to reload" prompt.
 * Exposes global `appUpdate`. Called from app.js. Service workers need HTTPS or localhost.
 *
 * sw.js is cache-first. After a deploy, the new worker installs in the background and then
 * WAITS (it doesn't take over by itself). This page shows a prompt; tapping it tells the waiting
 * worker to activate (SKIP_WAITING) and reloads once it controls the page. If something unsaved
 * is on screen (the New Receipt draft, Settings, a product/customer edit form, the quote editor),
 * the tap asks first. A waiting worker also activates on its own once every tab of the app is closed.
 *
 * Other open tabs: when one tab accepts the update, the rest see `controllerchange` and reload
 * only when it's safe: straight away if nothing unsaved is on screen, otherwise at the next
 * navigation once the New Receipt draft is empty (reloadIfReady, called by the router).
 * The very first install (no previous controller) shows no prompt and doesn't reload.
 */
(function () {
  'use strict';

  let updateReady = false;   // a new worker controls this page, which still runs the old code
  let accepted = false;      // the user tapped the prompt in this tab
  let reloading = false;
  let bar = null;

  /** Routes that are forms: a reload there could lose typing. */
  function onForm() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    return parts[0] === 'settings' || ((parts[0] === 'products' || parts[0] === 'customers') && parts.length > 1)
      || (parts[0] === 'quote' && (parts[1] === 'new' || parts[2] === 'edit'));
  }

  function hasDraft() {
    const v = window.Views && window.Views.new;
    return !!(v && v.hasDraft && v.hasDraft());
  }

  function reload() {
    if (reloading) return;
    reloading = true;
    location.reload();
  }

  /**
   * Called by the router at the start of each navigation, after the hash has changed.
   * Returns true if it is reloading (the caller should stop rendering).
   */
  function reloadIfReady() {
    if (!updateReady || hasDraft()) return false;
    reload();
    return true;
  }

  /** Show the prompt for a worker that has installed and is waiting. */
  function showPrompt(worker) {
    if (!bar) {
      bar = document.createElement('button');
      bar.type = 'button';
      bar.className = 'update-bar';
      bar.textContent = 'Update available, tap to reload';
      document.body.append(bar);
    }
    bar.hidden = false;
    bar.onclick = async () => {
      if (onForm() || hasDraft()) {
        const ok = await ui.confirm('Reload now to update? What you have typed on this screen will be lost.',
          { okText: 'Reload', cancelText: 'Not now' });
        if (!ok) return;
      }
      accepted = true;
      bar.hidden = true;
      if (updateReady || worker.state === 'activated' || worker.state === 'redundant') return reload();
      worker.postMessage({ type: 'SKIP_WAITING' }); // controllerchange then reloads
    };
  }

  function register() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    // Tracked live, not just at load: on a first visit the install takes control without a
    // reload, and later updates in that same tab still need one.
    let controlled = !!navigator.serviceWorker.controller;

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!controlled) { controlled = true; return; } // first install: this page is current
      updateReady = true;
      if (accepted || (!onForm() && !hasDraft())) reload();
    });

    navigator.serviceWorker.register('sw.js')
      .then((reg) => {
        const watch = (worker) => {
          if (!worker) return;
          const check = () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) showPrompt(worker);
          };
          check();
          worker.addEventListener('statechange', check);
        };
        watch(reg.waiting);                   // installed on an earlier visit, still waiting
        watch(reg.installing);
        reg.addEventListener('updatefound', () => watch(reg.installing));
        // An installed app can stay open for days: check for a new version when it comes back.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      })
      .catch((err) => console.error('SW registration failed', err));
  }

  window.appUpdate = { register, reloadIfReady };
})();

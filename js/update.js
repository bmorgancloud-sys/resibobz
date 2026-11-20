/*
 * update.js: service worker registration and automatic reload on app updates.
 * Exposes global `appUpdate`.
 *
 * sw.js is cache-first, so the first load after an update still runs the old code while the
 * new worker installs in the background. When the new worker takes control
 * (`controllerchange`), the page reloads to pick up the new code, but never on top of
 * unsaved input:
 *   - nothing unsaved on screen: reload straight away;
 *   - otherwise: reload at the next navigation, once the New Receipt draft is empty.
 *     Navigating away from an edit form discards it anyway, and the reload lands on
 *     the route the user was going to.
 * The very first install (no previous controller) doesn't reload: that page is already current.
 */
(function () {
  'use strict';

  let updateReady = false;
  let reloading = false;

  /** Routes that are forms: a reload there could lose typing. */
  function onForm() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    return parts[0] === 'settings' || ((parts[0] === 'products' || parts[0] === 'customers') && parts.length > 1);
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

  function register() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    // Tracked live, not just at load: on a first visit the install takes control without a
    // reload, and later updates in that same tab still need one.
    let controlled = !!navigator.serviceWorker.controller;

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!controlled) { controlled = true; return; } // first install: this page is current
      updateReady = true;
      if (!onForm() && !hasDraft()) reload();
    });

    navigator.serviceWorker.register('sw.js')
      .then((reg) => {
        // An installed app can stay open for days: check for a new version when it comes back.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      })
      .catch((err) => console.error('SW registration failed', err));
  }

  window.appUpdate = { register, reloadIfReady };
})();

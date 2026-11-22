/*
 * safety.js: protecting the one copy of the data that lives on this phone.
 *
 * - protect(): asks the browser to keep our storage (navigator.storage.persist) so it isn't
 *   cleared when the phone runs low on space; status(): "protected" or not, plus how full it is.
 * - exportBackup(): download a full backup and remember when (shared by Settings and the banner).
 * - backupBanner(): "Back up your receipts" when the last export is over 7 days old (or never).
 * - Global error handler: any uncaught error shows "Something went wrong" with "Export backup now".
 * - notSaved(): the one message for a failed write. Callers keep what was typed.
 * The small pure helpers (daysAgo, nearlyFull, ...) are unit-tested in Node (tests/safety.test.js).
 */
(function (root) {
  'use strict';

  const DAY_MS = 24 * 60 * 60 * 1000;
  const BACKUP_DAYS = 7;
  const NOT_SAVED = 'Not saved — try again';

  // ---- Pure helpers ----

  /** Whole local calendar days from `iso` to `now` (0 = today), or null if never/invalid. */
  function daysSince(iso, now = new Date()) {
    if (!iso) return null;
    const t = new Date(iso);
    if (!(t.getTime() > 0)) return null;
    const a = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.max(0, Math.round((b - a) / DAY_MS)); // round: DST days are 23/25 hours
  }

  /** "never", "today", "yesterday", "9 days ago". */
  function daysAgo(iso, now = new Date()) {
    const d = daysSince(iso, now);
    if (d == null) return 'never';
    if (d === 0) return 'today';
    if (d === 1) return 'yesterday';
    return d + ' days ago';
  }

  /** Storage is nearly full when 90% of the quota is used or under 25 MB is left. */
  function nearlyFull(usage, quota) {
    if (!(quota > 0) || !(usage >= 0)) return false;
    return usage / quota >= 0.9 || quota - usage < 25 * 1024 * 1024;
  }

  /** 1536 -> "1.5 KB", 5242880 -> "5 MB". */
  function formatBytes(n) {
    if (!(n >= 0)) return '';
    const units = ['bytes', 'KB', 'MB', 'GB'];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return (i ? String(Math.round(n * 10) / 10) : String(n)) + ' ' + units[i];
  }

  /** Errors the browser reports that are not ours to worry the user about. */
  function isNoise(message) {
    return /ResizeObserver loop|Script error\.?$/i.test(String(message || ''));
  }

  const pure = { DAY_MS, BACKUP_DAYS, NOT_SAVED, daysSince, daysAgo, nearlyFull, formatBytes, isNoise };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = pure;
    return;
  }

  // ---- Browser parts ----

  const { h, toast } = root.ui;

  let persistAsk = null;
  /** Ask once per load for persistent storage. Resolves true (protected), false, or null (unsupported). */
  function protect() {
    if (!persistAsk) {
      const s = navigator.storage;
      persistAsk = !s || !s.persist
        ? Promise.resolve(null)
        : s.persisted().then((yes) => yes || s.persist()).catch(() => false);
    }
    return persistAsk;
  }

  /** { persisted: true|false|null, usage, quota, nearlyFull } (usage/quota undefined when unknown). */
  async function status() {
    const persisted = await protect();
    let usage, quota;
    try {
      if (navigator.storage && navigator.storage.estimate) ({ usage, quota } = await navigator.storage.estimate());
    } catch {}
    return { persisted, usage, quota, nearlyFull: nearlyFull(usage, quota) };
  }

  /** Collect and download a full backup; records lastBackupAt only after the file was handed over. */
  async function exportBackup(now = new Date()) {
    const data = await root.backup.collect(now);
    root.ui.download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), root.backup.fileName(now));
    await root.db.setSetting('lastBackupAt', now.toISOString());
    return now.toISOString();
  }

  /** Export with button feedback. Resolves the new lastBackupAt, or null if it failed. */
  async function exportWithFeedback(btn) {
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Saving backup…';
    try {
      const iso = await exportBackup();
      toast('Backup saved to your downloads');
      return iso;
    } catch (err) {
      console.error(err);
      toast('Backup not saved — try again');
      return null;
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  /** "Back up your receipts" banner, or null when a backup was made in the last 7 days. */
  function backupBanner(lastBackupAt, receiptCount) {
    if (!root.filter.needsBackup(lastBackupAt, receiptCount, new Date(), BACKUP_DAYS)) return null;
    const btn = h('button', { type: 'button', class: 'btn' }, 'Export backup now');
    const box = h('div', { class: 'notice backup-banner', role: 'status' },
      h('strong', null, 'Back up your receipts'),
      h('div', null, 'Last backup: ' + daysAgo(lastBackupAt) + '. Your receipts are stored only on this phone.'),
      btn);
    btn.addEventListener('click', async () => {
      if (await exportWithFeedback(btn)) box.remove();
    });
    return box;
  }

  /** The message for a failed write. The caller leaves the form as it was. */
  function notSaved(err) {
    if (err) console.error(err);
    toast(NOT_SAVED);
  }

  // ---- "Something went wrong" ----

  let errorBar = null;
  function showError() {
    if (errorBar && errorBar.isConnected) return;
    const btn = h('button', { type: 'button', class: 'btn' }, 'Export backup now');
    const close = h('button', { type: 'button', class: 'btn btn-secondary' }, 'Dismiss');
    errorBar = h('div', { class: 'error-bar', role: 'alert' },
      h('strong', null, 'Something went wrong'),
      h('span', null, 'Your saved receipts are safe. To be sure, export a backup now.'),
      h('div', { class: 'error-bar-actions' }, btn, close));
    btn.addEventListener('click', async () => { if (await exportWithFeedback(btn)) errorBar.remove(); });
    close.addEventListener('click', () => errorBar.remove());
    document.body.append(errorBar);
  }

  function installErrorHandler() {
    window.addEventListener('error', (e) => {
      // Failed <script>/<img> loads also fire 'error' (without a message); those are handled where they happen.
      if (!e.message || isNoise(e.message)) return;
      showError();
    });
    window.addEventListener('unhandledrejection', (e) => {
      const r = e.reason;
      if (isNoise(r && r.message)) return;
      showError();
    });
  }

  /** Called once by app.js on start: error handler, storage protection, low-space warning. */
  async function init() {
    installErrorHandler();
    try {
      const s = await status();
      if (s.nearlyFull) {
        document.body.insertBefore(h('p', { class: 'banner storage-full', role: 'alert' },
          'Phone storage is nearly full, so new receipts may not save. Export a backup and free up some space.'),
          document.getElementById('view'));
      }
    } catch (err) {
      console.error(err);
    }
  }

  root.safety = { ...pure, protect, status, exportBackup, exportWithFeedback, backupBanner, notSaved, showError, init };
})(typeof window !== 'undefined' ? window : globalThis);

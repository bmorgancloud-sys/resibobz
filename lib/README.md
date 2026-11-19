# lib/

Vendored third-party libraries, served locally so the app works offline. Do not link to a CDN.
Both are MIT licensed (license headers are kept in the minified files).

| File                              | Package          | Version | Source |
|-----------------------------------|------------------|---------|--------|
| `jspdf.umd.min.js`                | jspdf            | 4.2.1   | https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js |
| `jspdf.plugin.autotable.min.js`   | jspdf-autotable  | 5.0.9   | https://cdn.jsdelivr.net/npm/jspdf-autotable@5.0.9/dist/jspdf.plugin.autotable.min.js |

Load jsPDF first. The autotable UMD build then attaches to `window.jspdf.jsPDF` and also
exposes a global `autoTable(doc, options)`, which `js/pdf.js` uses.

When upgrading, replace the file, update this table, and bump `CACHE_VERSION` in `sw.js`.

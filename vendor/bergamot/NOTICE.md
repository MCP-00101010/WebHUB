# Bergamot Translator

Morpheus WebHub includes Mozilla's JavaScript/WASM build of Bergamot Translator for local machine translation.

- Upstream project: <https://github.com/mozilla/translations>
- Firefox integration source: <https://github.com/mozilla-firefox/firefox>
- Bergamot release: `v0.6.0`
- Upstream revision: `1de4a085d3a7afb625c51a60aabb5ad298e4059f`
- Firefox integration snapshot: `b462c13f11417e13461f1202d71b14e2784f5db0`
- WASM SHA-256 before gzip embedding: `a3a89d9ad0a4ed8f27bf3e403701b23f5709816f6376438503f2fa5b0182c2dc`
- License: Mozilla Public License 2.0; see `LICENSE.txt`.

The generated `bergamot-wasm-data.js` contains a gzip-compressed, base64 representation of the upstream WASM binary. It is decoded only inside the translator worker. Translation models are downloaded on demand from Mozilla Remote Settings, verified by SHA-256, and stored in the browser's local IndexedDB asset cache.

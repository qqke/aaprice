# Continuous price scanning

Approved scope: keep the camera open between known products, pause while confirming or saving, and require the last barcode to leave the frame before accepting another scan. Query the existing catalog concurrently with OCR of the same captured frame. Warm and reuse one OCR worker; cap OCR crops at 1200 pixels. Preserve manual JAN input, missing-product submission, store and price validation, duplicate protection and retry after failed saves. Closing or stopping cancels late recognition results.

Implementation stays in `src/components/CompareApp.jsx`; price parsing and storage interfaces remain unchanged. No new dependencies or schema changes.

- [x] Add regression cases in `tests/scan-price.test.mjs` for concurrent lookup, camera retention and canceled lookup.
- [x] Implement camera loop pause, barcode departure gate, frame capture, worker preparation and generation guards.
- [x] Run targeted tests, all `npm test` tests and `npm run build`; review the final diff for stale closures and failure paths. Playwright checked `/scan/` at 1280×800 and 390×844: dialog rendering, invalid JAN feedback and denied camera fallback, with no page runtime errors. The Browser plugin was unavailable.
- [ ] Commit and push to the current release branch, then inspect `deploy.yml` for that exact commit.

Hardware limit: upright labels with the price above the barcode remain the supported crop. Browser camera/BarcodeDetector support and OCR quality must be measured on real phones; automated tests verify flow and safety, not optical accuracy.

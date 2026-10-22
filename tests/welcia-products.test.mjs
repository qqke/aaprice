import test from "node:test"
import assert from "node:assert/strict"
import { parseWelciaList } from "../scripts/crawl-welcia-products.mjs"

const card = '<li class="ec-shelfGrid__item"><a href="https://www.e-welcia.com/product/123"><img src="/a.jpg" alt="Test &amp; product"></a></li>'
test("Welcia uses explicit product code and card identity", () => {
  const result = parseWelciaList(`${card}<span class="ec-font-bold">1件</span><script>eccube.productsClassCategories = {"123":{"x":{"product_code":"4987241202171"}}};</script>`)
  assert.equal(result.total, 1)
  assert.equal(result.products[0].barcode, "4987241202171")
  assert.equal(result.products[0].name, "Test & product")
  assert.equal(result.products[0].imageUrl, "https://www.e-welcia.com/a.jpg")
})
test("Welcia rejects ambiguous variant codes and invalid checksums", () => {
  for (const data of [{ a: { product_code: "4987241202172" } }, { a: { product_code: "4987241202171" }, b: { product_code: "4901301465108" } }]) {
    const result = parseWelciaList(`${card}<script>eccube.productsClassCategories = ${JSON.stringify({ 123: data })};</script>`)
    assert.equal(result.products.length, 0)
    assert.equal(result.excluded.length, 1)
  }
})

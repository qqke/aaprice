import test from "node:test"
import assert from "node:assert/strict"
import { parseCategoryList } from "../scripts/crawl-kirindo-categories.mjs"

test("category counts exclude subgroup totals before the main product list", () => {
  const html = '<span class="fs-c-listControl__status__total">18</span><div class="fs-c-productList"><span class="fs-c-listControl__status__total">936</span><h2 class="fs-c-productListItem__productName"><a href="/c/kusuri/705928001206"><span class="fs-c-productName__name">A</span></a></h2>'
  assert.equal(parseCategoryList(html).total, 936)
  assert.equal(parseCategoryList(html).products.length, 1)
  assert.throws(() => parseCategoryList(html.split('<div class="fs-c-productList">')[0]), /Missing/)
  assert.throws(() => parseCategoryList(html.replace('>936<', '>0<')), /Invalid/)
})

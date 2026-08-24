import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const readSource = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8")

test("keeps production UI interaction contracts", async () => {
  const [buttons, inputs, admin, layout, shell, compare, product, auth] = await Promise.all([
    readSource("src/components/ui/button.tsx"),
    readSource("src/components/ui/input.tsx"),
    readSource("src/components/AdminApp.jsx"),
    readSource("src/layouts/BaseLayout.astro"),
    readSource("src/components/AppShell.jsx"),
    readSource("src/components/CompareApp.jsx"),
    readSource("src/components/ProductApp.jsx"),
    readSource("src/components/AuthApp.jsx"),
  ])

  assert.match(buttons, /default:\s*\n\s*"h-11[^"]*md:h-10/, "buttons need 44px mobile targets")
  assert.match(inputs, /"h-11[^"]*md:h-10/, "inputs need 44px mobile targets")
  assert.doesNotMatch(buttons, /md:h-[678]/, "desktop buttons must not shrink below usable targets")
  assert.doesNotMatch(inputs, /md:h-8/, "desktop inputs must not shrink below usable targets")
  assert.doesNotMatch(layout, /<div id="main-content"/, "the skip target must not wrap the site header")
  assert.match(shell, /<main id="main-content" tabIndex=\{-1\}>/)
  assert.match(compare, /<main id="main-content" tabIndex=\{-1\}>/)
  assert.match(compare, /env\(safe-area-inset-bottom\)/)
  assert.match(compare, /查询门店价/)
  assert.match(compare, /登录后将自动继续查询门店价格，当前比价清单不会丢失。/)
  assert.match(compare, /priceIntent=\{Boolean\(pendingPriceId\)\}/)
  assert.match(compare, /compareSource !== "account"/)
  assert.match(compare, /setSavedProducts\(\(items\) => items\.map/)
  assert.match(await readSource("src/components/MeApp.jsx"), /比较商品 \{dataCompareIds\.length\}/)
  assert.match(product, /env\(safe-area-inset-bottom\)/)
  assert.match(auth, /subscribeAuthState[\s\S]*?\.catch\(\(error\) =>/)
  assert.match(admin, /if \(await act\([\s\S]*?\)\) setProductForm\(blankProduct\)/)
  assert.match(admin, /if \(await act\([\s\S]*?\)\) setStoreForm\(blankStore\)/)
  assert.match(admin, /if \(await act\([\s\S]*?\)\) setPriceForm\(blankPrice\)/)
})

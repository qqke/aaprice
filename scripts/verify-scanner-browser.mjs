import assert from "node:assert/strict"

// Called by the isolated catalog verifier: synthetic camera only, all upstream APIs intercepted.
export async function verifyScannerBrowser(page, origin, missingJan) {
  await page.addInitScript(() => {
    const fixture = window.__scannerFixture = { mode: "denied", requests: 0, stops: 0, torch: false, results: [], crops: [] }
    const makeStream = () => {
      const canvas = document.createElement("canvas")
      canvas.width = 1280
      canvas.height = 720
      canvas.getContext("2d").fillRect(0, 0, 1280, 720)
      const stream = canvas.captureStream(10)
      const track = stream.getVideoTracks()[0]
      const stop = track.stop.bind(track)
      track.stop = () => { fixture.stops++; stop() }
      track.getCapabilities = () => ({ torch: true })
      track.applyConstraints = async ({ advanced }) => { fixture.torch = advanced[0].torch }
      return stream
    }
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => {
      fixture.requests++
      if (fixture.mode === "denied") throw new DOMException("Fixture permission denied", "NotAllowedError")
      if (fixture.mode === "pending") await new Promise(resolve => { fixture.resolve = resolve })
      return makeStream()
    } })
    window.BarcodeDetector = class {
      static async getSupportedFormats() { return ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"] }
      async detect(canvas) {
        fixture.crops.push({ width: canvas.width, height: canvas.height })
        return fixture.results
      }
    }
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(origin + "/scan/")
  const dialog = page.getByRole("dialog")
  await dialog.getByText(/相机权限未开启/).waitFor()
  assert.equal(await page.evaluate(() => window.__scannerFixture.requests), 1, "entry should attempt the camera once")
  assert.equal(await dialog.getByRole("button", { name: "启动相机", exact: true }).count(), 1)
  assert.equal(await dialog.getByRole("button", { name: "扫一扫", exact: true }).count(), 0, "no duplicate camera start control")
  await page.screenshot({ path: "artifacts/commercial-audit/scanner-camera.png" })
  await dialog.getByRole("button", { name: "手动输入", exact: true }).click()
  const input = dialog.getByRole("textbox", { name: "输入商品条码", exact: true })
  assert.equal(await input.evaluate(element => element === document.activeElement), true)
  assert.equal(await dialog.locator("video").count(), 0)
  await input.fill("123")
  await dialog.getByRole("button", { name: "查询商品", exact: true }).click()
  await dialog.getByRole("alert").filter({ hasText: "请输入 8 位" }).waitFor()
  assert.equal(await input.inputValue(), "123")
  assert.equal(await input.getAttribute("aria-invalid"), "true")
  assert.match(await input.getAttribute("aria-describedby"), /manual-jan-error/)
  assert.equal(await input.evaluate(element => element === document.activeElement), true)
  await page.screenshot({ path: "artifacts/commercial-audit/scanner-manual.png" })
  await page.setViewportSize({ width: 390, height: 400 })
  const queryBounds = await dialog.getByRole("button", { name: "查询商品", exact: true }).boundingBox()
  assert.ok(queryBounds.y + queryBounds.height <= 400, "manual query must remain visible in a short viewport")
  assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), true)
  await page.setViewportSize({ width: 390, height: 844 })
  let enrichmentRequests = 0
  const countEnrichment = request => { if (request.url().startsWith("https://r.jina.ai/")) enrichmentRequests++ }
  page.on("request", countEnrichment)
  await input.fill(missingJan)
  await input.press("Enter")
  await dialog.getByRole("heading", { name: "暂未收录此商品", exact: true }).waitFor()
  assert.equal(await dialog.locator("video, input:not([type=file])").count(), 0)
  assert.equal(enrichmentRequests, 0, "enrichment must wait for an explicit contribution choice")
  assert.equal(await dialog.getByRole("link", { name: "输入名称搜索", exact: true }).getAttribute("href"), "/#product-search")
  await page.screenshot({ path: "artifacts/commercial-audit/scanner-missing.png" })
  await dialog.getByRole("button", { name: "帮忙补录商品（可选）", exact: true }).click()
  const name = dialog.getByRole("textbox", { name: "商品名称", exact: true })
  await name.waitFor()
  assert.equal(await name.inputValue(), "")
  assert.equal(await name.evaluate(element => element === document.activeElement), true)
  assert.ok(enrichmentRequests > 0)
  page.off("request", countEnrichment)
  await dialog.getByRole("button", { name: "返回未收录结果", exact: true }).click()
  await page.evaluate(() => { window.__scannerFixture.mode = "success" })
  await dialog.getByRole("button", { name: "重新扫描", exact: true }).click()
  await dialog.getByRole("button", { name: "暂停扫描", exact: true }).waitFor()
  await page.waitForFunction(() => window.__scannerFixture.crops.length > 0)
  const crop = await page.evaluate(() => window.__scannerFixture.crops.at(-1))
  assert.ok(Math.abs(crop.width / crop.height - 2.6) < 0.08, "live decoding must use the wide guide, not the entire camera frame")
  await dialog.getByRole("button", { name: "开启手电筒", exact: true }).click()
  await dialog.getByRole("button", { name: "关闭手电筒", exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.__scannerFixture.torch), true)
  await dialog.getByRole("button", { name: "手动输入", exact: true }).click()
  assert.equal(await page.evaluate(() => window.__scannerFixture.stops), 1)
  await dialog.getByRole("button", { name: "返回扫码", exact: true }).click()
  await dialog.getByRole("button", { name: "暂停扫描", exact: true }).waitFor()
  await dialog.getByRole("button", { name: "关闭扫码", exact: true }).click()
  assert.equal(await page.evaluate(() => window.__scannerFixture.stops), 2)

  await page.goto(origin + "/scan/")
  await dialog.getByText(/相机权限未开启/).waitFor()
  await page.evaluate(() => { window.__scannerFixture.mode = "pending" })
  await dialog.getByRole("button", { name: "启动相机", exact: true }).click()
  await page.waitForFunction(() => Boolean(window.__scannerFixture.resolve))
  await dialog.getByRole("button", { name: "手动输入", exact: true }).click()
  await page.evaluate(() => window.__scannerFixture.resolve())
  await page.waitForFunction(() => window.__scannerFixture.stops === 1)
  assert.equal(await dialog.locator("video").count(), 0, "late camera permission must not resurrect the camera after switching tasks")
  await input.fill("4511413405048")
  await input.press("Enter")
  await page.waitForURL(origin + "/product/?id=needle")
  await page.getByText("匿名价格预览", { exact: true }).waitFor()
  await page.goto(origin + "/scan/?jan=123")
  await dialog.getByRole("alert").filter({ hasText: "请输入 8 位" }).waitFor()
  assert.equal(await input.inputValue(), "123")
  assert.equal(await dialog.locator("video").count(), 0)
  assert.equal(await page.evaluate(() => window.__scannerFixture.requests), 0, "JAN handoff must not request the camera")

  await page.goto(origin + "/scan/")
  await dialog.getByText(/相机权限未开启/).waitFor()
  await page.evaluate(() => { window.__scannerFixture.results = [{ rawValue: "4511413405048", boundingBox: { x: 0, y: 0, width: 1, height: 1 } }] })
  await dialog.locator('input[type="file"]').setInputFiles({ name: "fixture.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKWQAAAAASUVORK5CYII=", "base64") })
  await page.waitForURL(origin + "/product/?id=needle")
  await page.getByText("匿名价格预览", { exact: true }).waitFor()
  console.log("Scanner checks passed: single automatic start, permission fallback, focused standalone input, inline errors, opt-in enrichment, result focus, guide crop, torch, track cleanup, late permission cancellation, manual and album result navigation (synthetic camera).")
}

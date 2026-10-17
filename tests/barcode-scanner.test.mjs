import assert from "node:assert/strict"
import test from "node:test"
import { createBarcodeScanner } from "../src/lib/barcode-scanner.mjs"

test("mobile fallback decodes an actual EAN barcode without BarcodeDetector", async () => {
  const previous = globalThis.BarcodeDetector
  delete globalThis.BarcodeDetector
  try {
    const bars = "101" + "0001011" + "0100111" + "0011001" + "0010011" + "0100001" + "0011101" + "01010" + "1001110" + "1010000" + "1000100" + "1001000" + "1110100" + "1011100" + "101"
    const data = new Uint8ClampedArray(480 * 160 * 4).fill(255)
    for (let row = 0; row < 160; row++) {
      for (let column = 0; column < 480; column++) {
        if (row > 20 && row < 140 && bars[Math.floor((column - 50) / 4)] === "1") data.fill(0, (row * 480 + column) * 4, (row * 480 + column) * 4 + 3)
      }
    }
    const canvas = { width: 480, height: 160, getContext: () => ({ getImageData: () => ({ data }) }) }
    const scanner = await createBarcodeScanner()
    assert.equal((await scanner.detect(canvas))[0].rawValue, "4901234567894")
    data.fill(255)
    assert.deepEqual(await scanner.detect(canvas), [])
  } finally {
    if (previous) globalThis.BarcodeDetector = previous
  }
})

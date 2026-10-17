export async function createBarcodeScanner() {
  const formats = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"]
  try {
    const supported = await globalThis.BarcodeDetector?.getSupportedFormats()
    if (formats.every((format) => supported?.includes(format))) return new globalThis.BarcodeDetector({ formats })
  } catch {}
  const { BrowserMultiFormatOneDReader } = await import("@zxing/browser")
  const reader = new BrowserMultiFormatOneDReader()
  return {
    async detect(canvas) {
      try {
        const result = reader.decodeFromCanvas(canvas)
        const points = result.getResultPoints()
        const left = Math.min(...points.map((point) => point.getX()))
        const top = Math.min(...points.map((point) => point.getY()))
        return [{ rawValue: result.getText(), boundingBox: { x: left, y: top, width: Math.max(...points.map((point) => point.getX())) - left, height: 1 } }]
      } catch (error) {
        if (["NotFoundException", "ChecksumException", "FormatException"].includes(error.constructor.name)) return []
        throw error
      }
    },
  }
}

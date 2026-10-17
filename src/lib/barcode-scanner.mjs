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
        if (["NotFoundException", "ChecksumException", "FormatException"].includes(error.getKind?.())) return []
        throw error
      }
    },
  }
}

export async function scanBarcodeImage(file) {
  if (file.size > 20 * 1024 * 1024) throw new Error("图片不能超过 20 MB，请选择较小的图片。")
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    try { await image.decode() } catch { throw new Error("无法读取这张图片，请选择 JPG、PNG 或其他浏览器支持的图片。") }
    const scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight))
    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))
    const scanner = await createBarcodeScanner()
    const snapshot = document.createElement("canvas")
    for (const rotated of [false, true]) {
      snapshot.width = rotated ? height : width
      snapshot.height = rotated ? width : height
      const context = snapshot.getContext("2d")
      if (rotated) { context.translate(height, 0); context.rotate(Math.PI / 2) }
      context.drawImage(image, 0, 0, width, height)
      const results = (await scanner.detect(snapshot)).filter((item) => /^\d{8}$|^\d{12,14}$/.test(item.rawValue))
      if (results.length > 1) throw new Error("图片中有多个条码，请裁剪到一个商品后重试。")
      if (results.length) return { ...results[0], snapshot }
    }
    throw new Error("没有识别到商品条形码，请选择清晰的条码图片，或手动输入 JAN 码。")
  } finally {
    URL.revokeObjectURL(url)
  }
}

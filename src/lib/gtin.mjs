export function catalogGtin(barcode) {
  return /^(?:\d{8}|\d{12,14})$/.test(barcode) ? String(barcode).padStart(14, "0") : null
}

export function barcodeForms(barcode) {
  const identity = catalogGtin(barcode)
  if (!identity) return [barcode]
  return [8, 12, 13, 14]
    .map(length => identity.slice(-length))
    .filter(form => catalogGtin(form) === identity)
}

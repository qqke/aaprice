export function decodeRakutenHtml(bytes, contentType = "") {
  const hint = contentType + " " + new TextDecoder("latin1").decode(bytes.slice(0, 5000))
  const charset = hint.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] || "utf-8"
  return new TextDecoder(charset).decode(bytes)
}

export function isPurchasableRakutenItem(html, barcode) {
  try {
    const raw = html.match(/<script\b[^>]*\bid=["']item-page-app-data["'][^>]*>([\s\S]*?)<\/script>/i)?.[1]
    const item = JSON.parse(raw)?.api?.data?.itemInfoSku
    return item?.articleNumber?.value === barcode
      && typeof item.title === "string" && item.title.trim().length > 0
      && item.purchaseInfo?.purchaseBySellType?.purchaseCondition === "enabled"
      && item.purchaseInfo?.newPurchaseSku?.stockCondition !== "sold-out"
      && !/訳あり|中古|アウトレット/.test(item.title || "")
  } catch { return false }
}

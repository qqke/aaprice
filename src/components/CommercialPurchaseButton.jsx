import { useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { recordTelemetryEvent } from "@/lib/aprice-api.mjs"
import { observeCommercialExposure } from "@/lib/commercial-exposure.mjs"

export default function CommercialPurchaseButton({ offer, source, ...props }) {
  const ref = useRef(null)
  useEffect(() => observeCommercialExposure(ref.current, () => {
    void recordTelemetryEvent("commercial_offer_seen", {
      offer_id: offer.id, product_id: offer.product_id, source, measurement: "viewport_v1",
    }).catch(() => {})
  }), [offer.id, offer.product_id, source])
  return <Button ref={ref} {...props} />
}

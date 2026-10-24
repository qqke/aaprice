import { useState } from "react"
import { PackageOpen } from "lucide-react"
import { getImageSrcSet } from "@/lib/products.mjs"
import { cn } from "@/lib/utils"

export default function ProductImage({ src, alt, className, ...props }) {
  const [failedSrc, setFailedSrc] = useState("")
  if (!src || failedSrc === src) return <div role="img" aria-label={`${alt}：暂无商品图`} className={cn("flex h-full w-full flex-col items-center justify-center gap-2", className, "bg-muted text-muted-foreground")}><PackageOpen className="size-7" aria-hidden="true" /><span className="text-[10px]">暂无商品图</span></div>
  return <img {...props} src={src} srcSet={getImageSrcSet(src)} alt={alt} className={className} referrerPolicy="no-referrer" onError={() => setFailedSrc(src)} />
}

import { appPath } from "@/lib/paths.mjs"

export default function BrandLink({ compact = false }) {
  return (
    <a href={appPath("/")} aria-label="LOWPRICE 首页" className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <img src={appPath("/favicon.svg")} alt="" width="36" height="36" />
      <span className={`text-base font-bold tracking-tight${compact ? " hidden sm:inline" : ""}`}>LOWPRICE</span>
    </a>
  )
}

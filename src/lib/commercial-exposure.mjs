// Count a purchase button only when at least half is in view in an active tab.
export function observeCommercialExposure(element, onSeen) {
  if (typeof IntersectionObserver === "undefined") return () => {}
  let seen = false
  const observer = new IntersectionObserver((entries) => {
    if (seen || document.visibilityState !== "visible") return
    if (!entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5)) return
    seen = true
    observer.disconnect()
    onSeen()
  }, { threshold: 0.5 })
  const checkVisibility = () => {
    if (!seen && document.visibilityState === "visible") {
      observer.unobserve(element)
      observer.observe(element)
    }
  }
  observer.observe(element)
  document.addEventListener("visibilitychange", checkVisibility)
  return () => {
    seen = true
    observer.disconnect()
    document.removeEventListener("visibilitychange", checkVisibility)
  }
}

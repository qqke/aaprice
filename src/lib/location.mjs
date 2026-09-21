const KEY = "aprice:location"

export function readLocation() {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY))
    if (value && Date.now() - value.savedAt >= 0 && Date.now() - value.savedAt < 5 * 60 * 1000 && Number.isFinite(value.lat) && Math.abs(value.lat) <= 90 && Number.isFinite(value.lng) && Math.abs(value.lng) <= 180) return { lat: value.lat, lng: value.lng }
  } catch {}
  return null
}

export function requestLocation() {
  return new Promise((resolve, reject) => {
    if (!globalThis.navigator?.geolocation) { reject(new Error("当前浏览器不支持定位，请手动搜索门店。")); return }
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      const location = { lat: coords.latitude, lng: coords.longitude }
      try { sessionStorage.setItem(KEY, JSON.stringify({ ...location, savedAt: Date.now() })) } catch {}
      resolve(location)
    }, (error) => reject(new Error(error.code === 1 ? "位置权限被拒绝，请在浏览器网站设置中允许定位后重试。" : error.code === 3 ? "定位超时，请重试。" : "暂时无法获取位置，请检查设备定位服务后重试。")), { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 })
  })
}

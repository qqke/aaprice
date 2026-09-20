import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { buildImportSql, robotsAllow } from './crawl-drugstores.mjs'

export const directorySources = {
  create: { name: 'クリエイトエス・ディー', base: 'https://store.create-sd.co.jp', api: 'https://api.site.can-ly.com/v2/directories/29/shops/search?sort=alphabetical' },
  satudora: { name: 'サツドラ', base: 'https://shop.satudora.co.jp', api: 'https://api.site.can-ly.com/v2/directories/109/shops/search?sort=alphabetical' },
  tomods: { name: 'トモズ', base: 'https://shop.tomods.jp', api: 'https://g9ey9rioe.api.hp.can-ly.com/v2/companies/37/shops/search?sort=alphabetical' },
  sugi: { name: 'スギ薬局グループ', base: 'https://www2.sugi-net.jp' },
  cosmos: { name: 'コスモス', base: 'https://www.cosmospc.co.jp' },
  tsuruha: { name: 'ツルハグループ', base: 'https://shop.tsuruha-g.com' },
  matsukiyo: { name: 'マツキヨココカラ', base: 'https://www.matsukiyococokara-online.com' },
  daikoku: { name: 'ダイコクドラッグ', base: 'https://daikokudrug.com' },
  aoki: { name: 'クスリのアオキ', base: 'https://www.kusuri-aoki-shop-info.com' },
  cawachi: { name: 'カワチ薬品', base: 'https://www.cawachi.co.jp' },
  kirindo: { name: 'キリン堂', base: 'https://www.kirindo-shop.com' },
  yakuodo: { name: '薬王堂', base: 'https://www.yakuodo.co.jp' },
  vdrug: { name: 'V・ドラッグ', base: 'https://store.vdrug.co.jp', api: 'https://g9ey9rioe.api.hp.can-ly.com/v2/companies/904/shops/search?sort=alphabetical' },
  seki: { name: 'ドラッグストアセキ', base: 'https://www.sekiyakuhin.co.jp' },
  yutaka: { name: 'ドラッグユタカ', base: 'https://www.d-yutaka.co.jp' },
}
const plain = (s = '') => String(s).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
const weekdays = { MONDAY: '月', TUESDAY: '火', WEDNESDAY: '水', THURSDAY: '木', FRIDAY: '金', SATURDAY: '土', SUNDAY: '日', HOLIDAY: '祝', BEFORE_HOLIDAY: '祝前' }
const closureNote = value => /閉店(?!時間)|休業中|一時休業|期間休業/.test(plain(value))
export function validateStore(s) {
  if (!s.id || !s.name || !s.address || !Number.isFinite(s.lat) || !Number.isFinite(s.lng) || s.lat < 20 || s.lat > 46 || s.lng < 122 || s.lng > 154) throw Error('Missing identity/address or invalid Japan coordinates')
  return { ...s, pref: s.address.replace(/^〒?\d{3}-?\d{4}\s*/, '').match(/^(東京都|北海道|大阪府|京都府|.{2,3}県)/)?.[1] || '', city: s.city || '', hours: s.hours || '', channel: 'physical' }
}
export function parseCanlyStore(source, s, collectedAt) {
  const config = directorySources[source]
  const labels = s.checkBoxLabel?.checkBoxLabel?.items || []
  if ((s.openStatus || s.businessStatus) !== (s.openStatus ? 'IS_ALREADY_OPEN' : 'OPEN')) throw Error('Not currently established/open')
  if (s.baseInfo?.baseInfo?.publishStatus?.isPublished === false || labels.some(x => x.checked && /閉店|調剤専門店/.test(x.label))) throw Error('Unpublished, closed or dispensing-only store')
  if (source !== 'tomods' && !labels.some(x => x.checked && ['ドラッグストア','調剤併設ドラッグストア'].includes(x.label))) throw Error('Not classified as a drugstore')
  const brand = s.selectBrand?.selectBrand?.selected?.item?.brand?.label
  if (source === 'tomods' && !["Tomod's", 'AMERICAN PHARMACY', 'KATSUMATA'].includes(brand)) throw Error('Not a retail drugstore brand')
  const tax = labels.find(x => /免税/.test(x.label))
  return validateStore({ id: `${source}-${s.storeCode}`, name: s.nameKanji, chain_name: source === 'tomods' ? brand : config.name,
    address: s.address, lat: Number(s.latitude), lng: Number(s.longitude),
    hours: (s.businessHours || []).map(h => `${weekdays[h.name] || h.name} ${h.openTime && h.closeTime ? `${h.openTime.slice(0,5)}–${h.closeTime.slice(0,5)}` : '休業'}`).join('; '),
    phone: s.tel || s.phoneNumber || '', taxFree: tax ? tax.checked : null,
    sourceUrl: `${config.base}/all/`, sourceApiUrl: config.api, sourceStoreCode: s.storeCode, collectedAt })
}
export function parseSugiStore(s, collectedAt, sourceUrl) {
  const sales = s.storeInfo?.find(i => i.storeType === 'sales')
  if (!sales) throw Error('Dispensing-only store')
  if (closureNote(sales.businessHoursNote) || /閉鎖/.test(sales.businessHoursNote || '')) throw Error('Closure notice requires review')
  return validateStore({ id: `sugi-${s.id}`, name: `${sales.dbaName} ${s.name}`, chain_name: sales.dbaName,
    address: s.address.replace(/^〒[\d-]+\s*/, ''), lat: s.position?.lat, lng: s.position?.lng,
    hours: '', hoursNote: sales.businessHoursNote || '', taxFree: null,
    sourceUrl: `https://www2.sugi-net.jp/stores/${s.id}`, sourceApiUrl: sourceUrl, collectedAt })
}
export function parseCosmosList(text) {
  // The official search script applies this exact repair to malformed HTML attributes in its JSON.
  return JSON.parse(text.replace(/<span class="(labels|time_wrap|sub)">/g, '<span class=\\"$1\\">')).stores
}
export function parseCosmosStore(s, html, collectedAt) {
  if (/予定|閉店|休業/.test(plain(s.name_subinfo)) || !s.buys?.cosmetics || !s.business_hours || /調剤薬局/.test(plain(s.tel_label))) throw Error('Future, closed or dispensing-only Cosmos store')
  const lat = Number(html.match(/"latitude"\s*:\s*([\d.]+)/)?.[1]), lng = Number(html.match(/"longitude"\s*:\s*([\d.]+)/)?.[1])
  return validateStore({ id: `cosmos-${s.id}`, name: `ドラッグストアコスモス ${s.name}店`, chain_name: 'コスモス', address: plain(s.address), lat, lng,
    hours: plain(s.business_hours), phone: s.tel, taxFree: typeof s.services?.tax === 'boolean' ? s.services.tax : null, sourceUrl: s.detail_url, collectedAt })
}

export function parseTsuruhaEntity(s, collectedAt) {
  if (s.closed !== false || s.c_sf_storeType !== 'DRUGSTORE' || (s.c_openDate && s.c_openDate > collectedAt.slice(0,10))) throw Error('Closed, future or dispensing-only Tsuruha store')
  const url = s.c_pagesURL || s.websiteUrl?.url
  if (!/^https:\/\/shop\.tsuruha-g\.com\/\d+[a-z]?$/.test(url || '')) throw Error('Invalid official store URL')
  const brands = { TSURUHA_DRUG: 'ツルハドラッグ', KUSURI_NO_FUKUTARO: 'くすりの福太郎', WANTS: 'ウォンツ', WELLNESS: 'ウェルネス', LADY: 'くすりのレデイ', KYORINDO: '杏林堂', DRUG_ELEVEN: 'ドラッグイレブン' }
  const coord = s.yextDisplayCoordinate || s.displayCoordinate
  return validateStore({ id: `tsuruha-group-${new URL(url).pathname.slice(1)}`, name: s.name,
    chain_name: brands[s.c_brandFilter] || s.name.match(/ツルハドラッグ|くすりの福太郎|ウォンツ|ウェルネス|くすりのレデイ|杏林堂|ドラッグイレブン|B&D/)?.[0] || 'ツルハグループ',
    address: `${s.address.region}${s.address.city}${s.address.line1}${s.address.line2 ? ' '+s.address.line2 : ''}`, city: s.address.city,
    lat: coord?.latitude, lng: coord?.longitude, phone: s.mainPhone || '', taxFree: s.c_sa_fs_service_DutyFreeShop ?? null,
    hours: Object.entries(s.hours || {}).filter(([day]) => weekdays[day.toUpperCase()]).map(([day,h]) => `${weekdays[day.toUpperCase()]} ${h.isClosed ? '休業' : (h.openIntervals || []).map(i => `${i.start}–${i.end}`).join(', ')}`).join('; '), sourceUrl: url, collectedAt })
}
export function parseMatsukiyoDirectory(s, attrs, collectedAt) {
  const observed = Date.parse(collectedAt), jpDate = value => {
    if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$/.test(value)) throw Error('Invalid publication date')
    return Date.parse(value.replace(' ','T') + (value.length===16 ? ':00' : '') + '+09:00')
  }
  if (s.publish_start && jpDate(s.publish_start) > observed || s.publish_end && jpDate(s.publish_end) <= observed) throw Error('Outside publication dates')
  if (!['mon','tue','wed','thu','fri','sat','sun'].some(d => s[`store_open_time_${d}`])) throw Error('No retail hours (dispensing-only or inactive)')
  if (closureNote(s.comment)) throw Error('Closure notice requires review')
  const taxIndex = attrs.services.find(x=>x[1]==='免税対応')?.[0]
  return validateStore({ id: `mcc-${s.id}`, name: s.name, chain_name: attrs.icon.find(x=>x[0]===s.icon)?.[1] || 'マツキヨココカラグループ',
    address: s.address, lat: s.latitude, lng: s.longitude, phone: s.phone_store || '',
    taxFree: taxIndex && typeof s.services === 'string' && s.services.length >= taxIndex ? s.services[taxIndex-1] === '1' : null,
    hours: Object.entries({mon:'月',tue:'火',wed:'水',thu:'木',fri:'金',sat:'土',sun:'日',holiday:'祝'}).map(([d,n]) => `${n} ${s[`store_open_time_${d}`] ? `${s[`store_open_time_${d}`].slice(0,5)}–${s[`store_close_time_${d}`]?.slice(0,5) || '?'}` : '休業'}`).join('; '),
    sourceUrl: `https://www.matsukiyococokara-online.com/map?kid=${s.id}`, collectedAt })
}
export function parseDaikokuData(js) {
  const text = js.match(/JSON\.parse\('([\s\S]*)'\);export/)?.[1]
  if (!text) throw Error('Unrecognized public Daikoku JSON module')
  return JSON.parse(text.replace(/\\(['\\])/g, '$1'))
}
const prefectures = '北海道 青森県 岩手県 宮城県 秋田県 山形県 福島県 茨城県 栃木県 群馬県 埼玉県 千葉県 東京都 神奈川県 新潟県 富山県 石川県 福井県 山梨県 長野県 岐阜県 静岡県 愛知県 三重県 滋賀県 京都府 大阪府 兵庫県 奈良県 和歌山県 鳥取県 島根県 岡山県 広島県 山口県 徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 熊本県 大分県 宮崎県 鹿児島県 沖縄県'.split(' ')
export function parseDaikokuStore(s, collectedAt) {
  const date = new Date(Date.parse(collectedAt)+9*3600000).toISOString().slice(0,10)
  if (s.o_date > date || s.c_date <= date || /閉店|休業/.test(s.memo || '')) throw Error('Not an active Daikoku store')
  const pref = prefectures[Number(s.prefecture)-1]
  if (!pref) throw Error('Invalid prefecture')
  return validateStore({ id: `daikoku-${s.id}`, name: `ダイコクドラッグ ${s.name.replace(/^\d+\s*/, '')}`, chain_name: 'ダイコクドラッグ',
    address: `${pref}${s.add_1}${s.add_2 ? ' '+s.add_2 : ''}`, lat: Number(s.latitude), lng: Number(s.longitude), phone: s.tel,
    taxFree: s.tax_free === '1', hours: `${s.o_time?.slice(0,5)}–${s.c_time?.slice(0,5)}${s.ex_time ? '; '+s.ex_time : ''}`,
    sourceUrl: 'https://daikokudrug.com/store/', sourceStoreCode: s.code, collectedAt })
}
export function parseAokiStore(s, collectedAt) {
  if (/薬局$/.test(s.name) || !s.workingTime) throw Error('Dispensing-only or missing retail hours')
  return validateStore({ id: `aoki-${s.code}`, name: `クスリのアオキ ${s.name}`, chain_name: 'クスリのアオキ', address: s.address,
    lat: s.latitude, lng: s.longitude, hours: s.workingTime, phone: s.phone || '', taxFree: null,
    sourceUrl: `https://www.kusuri-aoki-shop-info.com/result?storeCode=${s.code}`, collectedAt })
}
export function parseCawachiStore(s, collectedAt) {
  if(s.businessTypeName !== 'ドラッグ' || closureNote(s.freeSpace1+s.freeSpace2)) throw Error('Not retail or closure notice requires review')
  return validateStore({id:`cawachi-${s.storeCode}`,name:`${s.prefixStoreName} ${s.storeName}`,chain_name:s.prefixStoreName,address:s.prefecturesName+s.city+s.buildingName,
    city:s.city,lat:s.latitude,lng:s.longitude,hours:s.salesTime,phone:s.tel,taxFree:/免税/.test(s.servicesName)?true:null,
    sourceUrl:`https://www.cawachi.co.jp/customer/store/shop.html?storeCode=${s.storeCode}`,collectedAt})
}
export function parseKirindoPage(html, url, collectedAt) {
  const markers=JSON.parse(html.match(/class="map-makers-json" value="([^"]+)"/)[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&'))
  const rows=[...html.matchAll(/<tr[\s\S]*?<\/tr>/g)].map(m=>m[0]), pref=new URL(url).searchParams.get('r')
  return markers.map(s=>{
    const idx=rows.findIndex(r=>r.includes(`./${s.store_code}.html`))
    return {...s,address:idx>=0?pref+plain(rows[idx+1]):'',collectedAt,sourceUrl:new URL(`./${s.store_code}.html`,url).href}
  })
}
export function parseKirindoStore(s) {
  if(!s.store_code.startsWith('DG') || /調剤|閉店|休業/.test(s.name)) throw Error('Not a retail Kirindo branch')
  return validateStore({id:`kirindo-${s.store_code}`,name:s.name,chain_name:'キリン堂',address:s.address,lat:Number(s.latitude),lng:Number(s.longitude),taxFree:null,sourceUrl:s.sourceUrl,collectedAt:s.collectedAt})
}
export function parseYakuodoStore(html,url,collectedAt) {
  const name=plain(html.match(/<h1 class="modHeadingShop__title">([\s\S]*?)<\/h1>/)?.[1])
  if(/薬局|閉店|休業/.test(name)) throw Error('Not an active retail Yakuodo branch')
  const address=plain(html.match(/〒\s*[\d-]+\s*(?:<br\s*\/?>)?\s*([^<]+)/)?.[1])
  const coord=html.match(/[?&]ll=([\d.]+),([\d.]+)/)
  const open=plain(html.match(/<span class="open">([\s\S]*?)<\/span>/)?.[1]), close=plain(html.match(/<span class="close">([\s\S]*?)<\/span>/)?.[1])
  return validateStore({id:`yakuodo-${new URL(url).pathname.split('/').filter(Boolean).at(-1)}`,name:`薬王堂 ${name}`,chain_name:'薬王堂',address,lat:Number(coord?.[1]),lng:Number(coord?.[2]),hours:open&&close?`${open}–${close}`:'',taxFree:null,sourceUrl:url,collectedAt})
}
export function parseSekiStore(s,collectedAt) {
  if(s.shop_category_id !== '1' || closureNote(s.comment)) throw Error('Dispensing-only or closure notice requires review')
  const coord=(s.geolocation || '').split(/[,\s]+/).filter(Boolean).map(Number)
  return validateStore({id:`seki-${s.number}`,name:`ドラッグストアセキ ${s.name}`,chain_name:'ドラッグストアセキ',address:s.address,lat:coord[0],lng:coord[1],hours:s.hours,phone:s.tel,taxFree:null,sourceUrl:'https://www.sekiyakuhin.co.jp/shop',sourceStoreCode:s.number,collectedAt})
}
export function parseYutakaPage(html,collectedAt) {
  const coords=new Map([...html.matchAll(/html\[\d+\] = [^\n]*href="https:\/\/www\.d-yutaka\.co\.jp\/shop\/(\d+)\.html"[^\n]*;\s*var lat = ([\d.]+);\s*var lng = ([\d.]+);/g)].map(m=>[m[1],[Number(m[2]),Number(m[3])]]))
  return html.split(/<div id="shopid/).slice(1).map(block=>{
    const id=block.match(/^(\d+)"/)?.[1],name=plain(block.match(/<h3>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/)?.[1])
    const value=label=>plain(block.match(new RegExp(`<th>${label}</th>\\s*<td>([\\s\\S]*?)</td>`))?.[1])
    return {id:`yutaka-${id}`,name,chain_name:'ドラッグユタカ',address:value('住所'),hours:value('営業時間'),phone:value('電話番号'),lat:coords.get(id)?.[0],lng:coords.get(id)?.[1],taxFree:null,sourceUrl:`https://www.d-yutaka.co.jp/shop/${id}.html`,collectedAt}
  })
}

export async function createFetcher(out, offline = false, resume = false) {
  await mkdir(`${out}/cache`, { recursive: true })
  const last = new Map(), policies = new Map()
  async function get(url, isRobots = false) {
    const origin = new URL(url).origin
    if (!isRobots && !policies.has(origin)) {
      const p = await get(`${origin}/robots.txt`, true)
      policies.set(origin, p.html)
    }
    if (!isRobots && !robotsAllow(policies.get(origin), url)) throw Error('robots.txt disallows this URL')
    const file = `${out}/cache/${createHash('sha256').update(url).digest('hex')}.json`
    try { const cached = JSON.parse(await readFile(file, 'utf8')); if (offline || resume || Date.now() - Date.parse(cached.collectedAt) < 86400000) return cached } catch {}
    if (offline) throw Error('No offline cache')
    await new Promise(r => setTimeout(r, Math.max(0, (last.get(origin) || 0) + 1000 - Date.now())))
    last.set(origin, Date.now())
    const response = await fetch(url, { headers: { 'User-Agent': 'AAPriceCatalog/1.0 (public drugstore directory)' }, signal: AbortSignal.timeout(25000) })
    if (!response.ok && !(isRobots && response.status === 404)) throw Error(`HTTP ${response.status}`)
    const saved = { url, collectedAt: new Date().toISOString(), html: response.status === 404 ? '' : await response.text() }
    await writeFile(file, JSON.stringify(saved))
    return saved
  }
  return get
}

async function main() {
  const args = process.argv.slice(2), option = (key, fallback) => args.find(x => x.startsWith(`--${key}=`))?.slice(key.length + 3) || fallback
  const out = option('out', 'artifacts/drugstores-national-2026-09-12'), selected = option('sources', Object.keys(directorySources).join(',')).split(',')
  if (selected.some(s => !directorySources[s])) throw Error('Unknown source')
  const get = await createFetcher(out, args.includes('--offline'), args.includes('--resume'))
  const stores = [], failures = [], coverage = {}
  const accept = (source, row, parse) => { try { stores.push(parse()); coverage[source].accepted++ } catch(e) { failures.push({ source, id: row.id || row.storeCode || row.meta?.id || row.store_code || row.code || row.number, name: row.name || row.nameKanji, reason: e.message }); coverage[source].excluded++ } }
  async function save() {
    const unique = [...new Map(stores.map(s => [s.id, s])).values()]
    await writeFile(`${out}/stores.json`, JSON.stringify(unique, null, 2))
    await writeFile(`${out}/report.json`, JSON.stringify({ generatedAt: new Date().toISOString(), databaseApplied: false, coverage, stores: unique.length, failures }, null, 2))
    await writeFile(`${out}/import.sql`, buildImportSql([], unique))
  }
  // Different source hosts run independently; requests within each source are sequential and rate limited.
  const results = await Promise.allSettled(selected.map(async source => {
    coverage[source] = { discovered: 0, accepted: 0, excluded: 0, enumerationComplete: false }
    const c = coverage[source]
    if (directorySources[source].api) {
      await get(`${directorySources[source].base}/all/`)
      const saved = await get(directorySources[source].api), data = JSON.parse(saved.html)
      if (!Array.isArray(data.shops) || !data.shops.length) throw Error('Empty or invalid shop payload')
      c.discovered = data.shops.length
      for (const s of data.shops) accept(source, s, () => parseCanlyStore(source, s, saved.collectedAt))
      c.enumerationComplete = true
    } else if (source === 'sugi') {
      const seen = new Set()
      for (let page = 1; page <= 1000; page++) {
        const url = `https://bff.sugi-net.jp/stores/by-area?page=${page}`, saved = await get(url), data = JSON.parse(saved.html)
        if (!Array.isArray(data.stores) || !Number.isInteger(data.totalNum)) throw Error('Invalid Sugi page')
        c.discovered = data.totalNum
        if (!data.stores.length && seen.size < c.discovered) throw Error('Pagination ended before total')
        for (const s of data.stores) { if (seen.has(s.id)) throw Error('Repeated Sugi pagination ID'); seen.add(s.id); accept(source, s, () => parseSugiStore(s, saved.collectedAt, url)) }
        if (seen.size >= c.discovered) { c.enumerationComplete = true; break }
        if (page % 25 === 0) console.log(`sugi: ${seen.size}/${c.discovered}`)
      }
    } else if (source === 'tsuruha') {
      const home = await get(directorySources.tsuruha.base + '/')
      const props = JSON.parse(decodeURIComponent(home.html.match(/JSON.parse\(decodeURIComponent\("([^"]+)"\)\)/)[1]))
      const env = props.document._env
      const seen = new Set()
      let pageToken = ''
      do {
        const query = new URLSearchParams({ api_key: env.YEXT_PUBLIC_LIVE_API_KEY, v: '20240306', entityTypes: 'location', savedFilterIds: env.YEXT_PUBLIC_ENTITY_SAVEDFILTERIDS, limit: '50', languages: 'ja', ...(pageToken ? { pageToken } : {}) })
        const saved = await get(`https://cdn.yextapis.com/v2/accounts/me/entities?${query}`), data = JSON.parse(saved.html)
        if (data.meta?.errors?.length || !Array.isArray(data.response?.entities)) throw Error('Invalid Yext directory response')
        c.discovered = data.response.count
        for (const s of data.response.entities) { if(seen.has(s.meta.id)) throw Error('Repeated Yext page'); seen.add(s.meta.id); accept(source,s,()=>parseTsuruhaEntity(s,saved.collectedAt)) }
        pageToken = data.response.pageToken || ''
        if(seen.size >= c.discovered) break
      } while(pageToken)
      c.enumerationComplete = seen.size === c.discovered
      if(!c.enumerationComplete) throw Error('Incomplete Yext pagination')
    } else if (source === 'matsukiyo') {
      const page = await get(directorySources.matsukiyo.base + '/map/search')
      const config = JSON.parse(page.html.match(/window.config\s*=\s*(\{[\s\S]*?\});/)[1])
      const saved = await get(config.stores), rows = JSON.parse(saved.html), attrs = JSON.parse((await get(config.storeAttributes)).html)
      if(!Array.isArray(rows) || !rows.length) throw Error('Invalid Matsukiyo directory')
      c.discovered = rows.length
      for(const s of rows) accept(source,s,()=>parseMatsukiyoDirectory(s,attrs,saved.collectedAt))
      c.enumerationComplete = true
    } else if (source === 'daikoku') {
      const home = await get(directorySources.daikoku.base + '/store/')
      const appPath = home.html.match(/import\("([^"\n]*entry\/app\.[^"]+)"\)/)?.[1]
      const app = await get(new URL(appPath, directorySources.daikoku.base+'/store/').href)
      const nodePath = app.html.match(/\.\.\/nodes\/31\.[^"']+\.js/)?.[0]
      const node = await get(new URL(nodePath,app.url).href)
      // The store page imports its JSON directory as a default export.
      const dataPath = node.html.match(/import \w+ from"([^"\n]+)"/)?.[1]
      const saved = await get(new URL(dataPath,node.url).href), rows = parseDaikokuData(saved.html)
      c.discovered=rows.length
      for(const s of rows) accept(source,s,()=>parseDaikokuStore(s,saved.collectedAt))
      c.enumerationComplete=true
    } else if (source === 'aoki') {
      const seen = new Set()
      for(let page=1;page<=1000;page++) {
        const saved=await get(`${directorySources.aoki.base}/result?searchword=&page=${page}&size=15`)
        const data=JSON.parse(saved.html.match(/var pageStores = (\{[\s\S]*?\});/)[1])
        c.discovered=data.totalElements
        for(const s of data.content) { if(seen.has(s.code)) throw Error('Repeated Aoki page'); seen.add(s.code); accept(source,s,()=>parseAokiStore(s,saved.collectedAt)) }
        if(data.last) { c.enumerationComplete=seen.size===c.discovered; break }
      }
      if(!c.enumerationComplete) throw Error('Incomplete Aoki pagination')
    } else if(source === 'cawachi') {
      const saved=await get('https://www.cawachi.co.jp/customer/_assets/corp/storeAll.json'),data=JSON.parse(saved.html)
      c.discovered=data.result.count
      if(data.result.rows.length!==c.discovered) throw Error('Incomplete Cawachi list')
      for(const s of data.result.rows) accept(source,s,()=>parseCawachiStore(s,saved.collectedAt))
      c.enumerationComplete=true
    } else if(source === 'kirindo') {
      const home=await get('https://www.kirindo-shop.com/manage/shop/shop.html')
      const urls=[...new Set([...home.html.matchAll(/href="(\.\/shop_list.html\?r=[^"]+)"/g)].map(m=>new URL(m[1],home.url).href))]
      if(!urls.length) throw Error('No Kirindo prefectures')
      for(const url of urls) {
        const saved=await get(url),rows=parseKirindoPage(saved.html,url,saved.collectedAt)
        c.discovered+=rows.length
        for(const s of rows) accept(source,s,()=>parseKirindoStore(s))
      }
      c.enumerationComplete=true
    } else if(source === 'yakuodo') {
      const home=await get('https://www.yakuodo.co.jp/shop/result/')
      const urls=[...new Set([...home.html.matchAll(/href="(https:\/\/www\.yakuodo\.co\.jp\/shop\/\d+\/)"/g)].map(m=>m[1]))]
      if(!urls.length) throw Error('No Yakuodo stores')
      c.discovered=urls.length
      for(const url of urls) {
        try {const saved=await get(url);accept(source,{id:url},()=>parseYakuodoStore(saved.html,url,saved.collectedAt))}
        catch(e){failures.push({source,url,reason:e.message});if(/HTTP (403|429)/.test(e.message)) throw e}
        if((c.accepted+c.excluded)%100===0) console.log(`yakuodo: ${c.accepted}/${c.discovered}`)
      }
      c.enumerationComplete=true
    } else if(source === 'seki') {
      const saved=await get('https://www.sekiyakuhin.co.jp/shop'),rows=JSON.parse(saved.html.match(/shops: (\[[^\n]+\]),/)[1])
      c.discovered=rows.length
      for(const s of rows) accept(source,s,()=>parseSekiStore(s,saved.collectedAt))
      c.enumerationComplete=true
    } else if(source === 'yutaka') {
      const saved=await get('https://www.d-yutaka.co.jp/?mode=shop-list&s='),rows=parseYutakaPage(saved.html,saved.collectedAt)
      c.discovered=rows.length
      for(const s of rows) accept(source,s,()=>{if(!/^ドラッグユタカ/.test(s.name)) throw Error('Dispensing-only Yutaka record');return validateStore(s)})
      c.enumerationComplete=true
    } else if (source === 'cosmos') {
      const saved = await get('https://www.cosmospc.co.jp/shop/shop_list.json'), rows = parseCosmosList(saved.html)
      if (!Array.isArray(rows) || !rows.length) throw Error('Invalid Cosmos directory')
      c.discovered = rows.length
      for (const s of rows) {
        if (/予定|閉店|休業/.test(plain(s.name_subinfo)) || !s.buys?.cosmetics || !s.business_hours) { accept(source, s, () => { throw Error('Future, closed or dispensing-only Cosmos store') }); continue }
        try { const page = await get(s.detail_url); accept(source, s, () => parseCosmosStore(s, page.html, page.collectedAt)) }
        catch(e) { failures.push({ source, id: s.id, url: s.detail_url, reason: e.message }); if (/HTTP (403|429)/.test(e.message)) throw e }
        if ((c.accepted + c.excluded) % 100 === 0) { console.log(`cosmos: ${c.accepted}/${c.discovered}`); await save() }
      }
      c.enumerationComplete = true
    }
    console.log(`${source}: ${c.accepted} accepted, ${c.excluded} excluded of ${c.discovered}`)
  }))
  results.forEach((r, i) => { if (r.status === 'rejected') failures.push({ source: selected[i], reason: r.reason.message }) })
  await save()
  if (results.some(r => r.status === 'rejected')) process.exitCode = 1
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message); process.exitCode = 1 })

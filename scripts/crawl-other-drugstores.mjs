import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';

const outDir = path.resolve('artifacts/drugstores-other-2026-09-13');
const sources = {
  'ウェルパーク': 'https://www.welpark.jp/shop/',
  'コクミン': 'https://www.kokumin.co.jp/shop/',
  'ダックス': 'https://www.dacs.jp/shop/',
  'よどやドラッグ': 'https://www.yodoya.com/shop/',
  'ふく薬品': 'https://www.fukuyakuhin.co.jp/shop/',
  'クスリのコダマ': 'https://www.kusuri-aoki.co.jp/shop/',
  'スギヤマ薬品': 'https://www.sugiyama.co.jp/shop/',
  'ハックドラッグ': 'https://www.hacdrug.com/shop/'
};
const agent = new https.Agent({ rejectUnauthorized: false });
async function get(url) {
  const r = await fetch(url, { agent, redirect: 'follow', headers: { 'user-agent': 'aaprice-directory-crawler/1.0' } });
  return { status: r.status, url: r.url, html: await r.text() };
}
function clean(s) { return s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim(); }
function parse(name, page) {
  const rows = new Map();
  const html = page.html;
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const j = JSON.parse(m[1].trim()); for (const x of (Array.isArray(j) ? j : [j])) if (x?.address?.streetAddress || x?.name) { const a = x.address; const address = typeof a === 'string' ? a : [a?.postalCode, a?.addressRegion, a?.addressLocality, a?.streetAddress].filter(Boolean).join(' '); if (address && /県|都|府|道/.test(address)) rows.set(`${x.name}|${address}`, { chain_name:name, name:x.name, address, phone:x.telephone ?? null, lat:x.geo?.latitude ? Number(x.geo.latitude) : null, lng:x.geo?.longitude ? Number(x.geo.longitude) : null, source_url:page.url }); } } catch {}
  }
  const text = clean(html);
  for (const m of text.matchAll(/((?:北海道|東京都|大阪府|京都府|沖縄県|青森県|岩手県|宮城県|秋田県|山形県|福島県|茨城県|栃木県|群馬県|埼玉県|千葉県|神奈川県|新潟県|富山県|石川県|福井県|山梨県|長野県|岐阜県|静岡県|愛知県|三重県|滋賀県|兵庫県|奈良県|和歌山県|鳥取県|島根県|岡山県|広島県|山口県|徳島県|香川県|愛媛県|高知県|福岡県|佐賀県|長崎県|熊本県|大分県|宮崎県|鹿児島県)[^|<>]{4,100})/g)) { const address=m[1].trim(); if (/市|区|町|村/.test(address)) rows.set(address, {chain_name:name,name: name+' '+address.slice(0,18),address,phone:null,lat:null,lng:null,source_url:page.url}); }
  return [...rows.values()];
}
await fs.mkdir(outDir, { recursive: true });
const report = { generatedAt:new Date().toISOString(), sources:[] };
for (const [name,url] of Object.entries(sources)) { try { const page=await get(url); const stores=page.status===200?parse(name,page):[]; await fs.writeFile(path.join(outDir, name+'.json'), JSON.stringify({source:name,url,status:page.status,stores},null,2)); report.sources.push({name,url,status:page.status,discovered:stores.length,valid:stores.filter(x=>x.address).length,withCoordinates:stores.filter(x=>x.lat&&x.lng).length}); } catch(e) { report.sources.push({name,url,status:'error',error:String(e)}); } }
await fs.writeFile(path.join(outDir,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));

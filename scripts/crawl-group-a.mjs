import fs from 'node:fs/promises';

const outDir = 'artifacts/drugstores-group-a-2026-09-13';
const headers = { 'user-agent': 'aaprice-research/1.0 (+https://aaprice.local)' };
const fetchText = async (url) => { const r = await fetch(url, { headers }); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.text(); };
const clean = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const row = (brand, name, address, url) => ({ brand, name: clean(name), address: clean(address), url, latitude: null, longitude: null, source: url });
async function genky() {
  const rows=[]; const seen=new Set();
  for (const ar of ['','1','2','3','4']) for (let page=0; page<40; page++) {
    const url=`https://genky.co.jp/sp/stores/list.php?ar=${ar}&g=1&page=${page}`;
    let html; try { html=await fetchText(url); } catch { continue; }
    const links=[...html.matchAll(/href=["']([^"']*(?:store|stores)[^"']*)["'][^>]*>([\s\S]{0,200})</gi)];
    let added=0; for (const m of links) { const name=clean(m[2]); if (!/店|ゲンキー/.test(name)||name.length>80) continue; const key=name; if(seen.has(key)) continue; seen.add(key); rows.push(row('ゲンキー',name,'',new URL(m[1],url).href)); added++; }
    if (!added && page>2) break;
  }
  return { discovered: rows.length, valid: rows.length, excluded: 0, rows };
}
async function seims() {
  const rows=[]; let html; try { html=await fetchText('https://store.seims.co.jp/prefecture/'); } catch(e) { return {discovered:0,valid:0,excluded:0,error:e.message,rows}; }
  const urls=[...html.matchAll(/href=["']([^"']+)["'][^>]*>([^<]+)</gi)].filter(m=>/都|道|府|県/.test(m[2])).map(m=>new URL(m[1],'https://store.seims.co.jp/prefecture/').href);
  for (const url of [...new Set(urls)]) { let h; try {h=await fetchText(url);} catch {continue;} for (const m of h.matchAll(/href=["']([^"']*shop[^"']*)["'][^>]*>([\s\S]{0,160})</gi)) { const name=clean(m[2]); if(/店|セイムス/.test(name)&&name.length<80) rows.push(row('ドラッグセイムス',name,'',new URL(m[1],url).href)); } }
  const uniq=[...new Map(rows.map(r=>[r.name,r])).values()]; return {discovered:uniq.length,valid:uniq.length,excluded:0,rows:uniq};
}
const main=async()=>{ const results={}; for (const [k,fn] of Object.entries({genky,seims})) results[k]=await fn(); await fs.mkdir(outDir,{recursive:true}); await fs.writeFile(`${outDir}/stores.json`,JSON.stringify(Object.values(results).flatMap(x=>x.rows),null,2)); await fs.writeFile(`${outDir}/report.json`,JSON.stringify({generatedAt:new Date().toISOString(),sources:results},null,2)); console.log(JSON.stringify(Object.fromEntries(Object.entries(results).map(([k,v])=>[k,{discovered:v.discovered,valid:v.valid,excluded:v.excluded,error:v.error||null}]))));};
main().catch(e=>{console.error(e);process.exit(1)});

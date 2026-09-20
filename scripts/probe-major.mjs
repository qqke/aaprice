for (const [n,u] of [['yacs','https://yacs.jp/'],['arka','https://arka.co.jp/'],['yam','https://www.yamazawa-drg.co.jp/']]) {
  const t=await (await fetch(u)).text(); console.log('\n'+n,t.length)
  console.log([...t.matchAll(/href="([^"]*(?:shop|store|tenpo|店舗)[^"]*)/gi)].slice(0,15).map(m=>m[1]).join('\n'))
  console.log('coords',(t.match(/-?\d{2}\.\d{4,}/g)||[]).slice(0,10))
}
const y=await (await fetch('https://yacs.jp/my_store')).text(); console.log('MY',y.length,[...y.matchAll(/href="([^"]+)"/g)].map(m=>m[1]).filter(x=>/store|shop|tenpo|map/i.test(x)).slice(0,60).join('\n'))
console.log(y.includes('Google Maps'),y.match(/<h[234][^>]*>[^<]*(?:店|薬局)[^<]*/g)?.slice(0,10)); console.log(y.match(/iframe[^>]+/g)?.slice(0,3))
const z=await(await fetch('https://www.yamazawa-drg.co.jp/shop/')).text(); console.log('YAMSHOP',z.length,[...z.matchAll(/href="([^"]+)"/g)].map(m=>m[1]).filter(x=>/shop|store|map/i.test(x)).slice(0,50).join('\n'))
const yd=await(await fetch('https://yacs.jp/drug-store/')).text(); console.log('YDRUG',yd.length,(yd.match(/店舗/g)||[]).length,(yd.match(/iframe/g)||[]).length); console.log([...yd.matchAll(/href="([^"]+)"/g)].map(m=>m[1]).filter(x=>/store|shop|map|tenpo/i.test(x)).slice(0,40).join('\n'))

export const normalizeIdentityText = s => String(s||'').normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu,'')
export function canonicalStoreIdentity(s){
  const chain=normalizeIdentityText(s.chain_name).replace(/グループ$/,'')
  const name=normalizeIdentityText(s.name).replaceAll(normalizeIdentityText(s.chain_name),'')
  return `${chain}|${name}|${normalizeIdentityText(s.address)}`
}

// Same branch after a move or same-source rebranding needs review, not a new ID.
const reviewKeys=s=>[`branch:${canonicalStoreIdentity({...s,address:''})}|${s.pref}`,`name:${normalizeIdentityText(s.name).replaceAll('グループ','')}|${s.pref}`,`address:${s.id.split('-')[0]}|${normalizeIdentityText(s.address)}`]
export function indexExistingBranches(existing){
  const index=new Map()
  for(const s of existing)for(const key of reviewKeys(s)){
    if(!index.has(key))index.set(key,new Set())
    index.get(key).add(s.id)
  }
  return index
}
export function possibleExistingBranches(store,existing){
  const index=existing instanceof Map?existing:indexExistingBranches(existing)
  return [...new Set(reviewKeys(store).flatMap(key=>[...(index.get(key)||[])]))].filter(id=>id!==store.id)
}

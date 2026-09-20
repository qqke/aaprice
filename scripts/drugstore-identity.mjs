export const normalizeIdentityText = s => String(s||'').normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu,'')
export function canonicalStoreIdentity(s){
  const chain=normalizeIdentityText(s.chain_name).replace(/グループ$/,'')
  const name=normalizeIdentityText(s.name).replace(normalizeIdentityText(s.chain_name),'')
  return `${chain}|${name}|${normalizeIdentityText(s.address)}`
}

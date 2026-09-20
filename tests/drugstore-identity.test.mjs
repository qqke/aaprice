import test from 'node:test'
import assert from 'node:assert/strict'
import {canonicalStoreIdentity} from '../scripts/drugstore-identity.mjs'
test('Brand suffix and group prefix resolve to same branch, but separate brands do not',()=>{
  const old={name:'扶桑店-サンドラッグ',chain_name:'サンドラッグ',address:'愛知県丹羽郡扶桑町７－１'}
  const fresh={name:'サンドラッググループ 扶桑店',chain_name:'サンドラッググループ',address:'愛知県丹羽郡扶桑町7-1'}
  assert.equal(canonicalStoreIdentity(old),canonicalStoreIdentity(fresh))
  assert.notEqual(canonicalStoreIdentity(old),canonicalStoreIdentity({...fresh,chain_name:'別ブランド'}))
  assert.notEqual(canonicalStoreIdentity(old),canonicalStoreIdentity({...fresh,address:'愛知県丹羽郡扶桑町7-2'}))
})

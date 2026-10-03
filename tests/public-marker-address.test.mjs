import assert from 'node:assert/strict'
import {verifyMarkerAddress} from '../scripts/official-embed-marker.mjs'
const row={address:'〒123-4567 山梨県甲府市大里町１９０１－１'}
assert.doesNotThrow(()=>verifyMarkerAddress({coordinateEntityAddress:'山梨県甲府市大里町1901番地1'},row))
assert.throws(()=>verifyMarkerAddress({coordinateEntityAddress:'山梨県韮崎市大里町1901-1'},row),/locality differs/)
assert.throws(()=>verifyMarkerAddress({coordinateEntityAddress:'山梨県甲府市大里町1901-2'},row),/numbers differ/)
assert.throws(()=>verifyMarkerAddress({coordinateEntityAddress:'山梨県甲府市大里町'},row),/numbers differ/)
assert.throws(()=>verifyMarkerAddress({coordinateEntityAddress:'山梨県甲府市大里町'}, {address:'山梨県甲府市大里町'}),/no building/)
assert.doesNotThrow(()=>verifyMarkerAddress({coordinateEntityAddress:'山梨県甲府市大里町1901-1 イオン3030 2F'}, {address:'山梨県甲府市大里町1901番地1 イオン3030'}))
console.log('Public marker address: municipality and every street/building number checked')

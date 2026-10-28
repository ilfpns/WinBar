// firestore.rules, checked in the Firestore emulator (the same rules engine as the live server) with two invited
// accounts and one that isn't: Together (asks, who may read, who may answer what, who may take back) and the
// change log. Needs Java and, once, `npm i --no-save @firebase/rules-unit-testing firebase`; then from haru/:
//
//   RULES=$PWD/firestore.rules npx -y firebase-tools@14 emulators:exec --only firestore --project haru-5e81a "node scripts/rules-test.mjs"
//
// Prints PASS/FAIL per check; exits 1 on any FAIL. (QA.md 2026-10-28 v1.75)
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { collection, doc, setDoc, addDoc, getDocs, query, where, updateDoc, deleteDoc, getDoc } from 'firebase/firestore';
const env = await initializeTestEnvironment({ projectId: 'haru-5e81a', firestore: { rules: readFileSync(process.env.RULES, 'utf8'), host: '127.0.0.1', port: 8080 } });
await env.clearFirestore();
await env.withSecurityRulesDisabled(async (c) => { const db = c.firestore(); await setDoc(doc(db, 'allow', 'a@x'), { at: 1 }); await setDoc(doc(db, 'allow', 'b@x'), { at: 1 }); await setDoc(doc(db, 'allow', 'c@x'), { at: 1 }); });
const as = (uid, email) => env.authenticatedContext(uid, { email, email_verified: true }).firestore();
const A = as('uA', 'a@x'), B = as('uB', 'b@x'), C = as('uC', 'c@x');
const results = [];
const check = async (name, p, shouldPass = true) => { try { await (shouldPass ? assertSucceeds(p) : assertFails(p)); results.push('PASS ' + name); } catch (e) { results.push('FAIL ' + name + ' — ' + String(e.message || e).split('\n')[0].slice(0, 100)); } };
const ask = { from: 'uA', fromName: 'A', to: ['uB'], date: '2026-12-31', title: 'Group study', cat: 'study', start: 900, dur: 90, created: 1, answers: {} };
let ref;
await check('A asks B', (async () => { ref = await addDoc(collection(A, 'together'), ask); })());
await check('A cannot ask in B\'s name', addDoc(collection(A, 'together'), { ...ask, from: 'uB', to: ['uA'] }), false);
await check('A cannot create with an answer already in', addDoc(collection(A, 'together'), { ...ask, answers: { uB: 'yes' } }), false);
await check('B lists asks to B (array-contains)', getDocs(query(collection(B, 'together'), where('to', 'array-contains', 'uB'))));
await check('A lists asks by A (from ==)', getDocs(query(collection(A, 'together'), where('from', '==', 'uA'))));
await check('C (not asked) cannot read it', getDoc(doc(C, 'together', ref.id)), false);
await check('C cannot list asks to B', getDocs(query(collection(C, 'together'), where('to', 'array-contains', 'uB'))), false);
await check('B answers yes (own answer only)', updateDoc(doc(B, 'together', ref.id), { 'answers.uB': 'yes' }));
await check('B cannot answer for A', updateDoc(doc(B, 'together', ref.id), { 'answers.uA': 'no' }), false);
await check('B cannot change the title', updateDoc(doc(B, 'together', ref.id), { title: 'x' }), false);
await check('B cannot give an answer other than yes/no', updateDoc(doc(B, 'together', ref.id), { 'answers.uB': 'maybe' }), false);
await check('B cannot delete A\'s ask', deleteDoc(doc(B, 'together', ref.id)), false);
await check('A takes it back', deleteDoc(doc(A, 'together', ref.id)));
await check('B writes own log entry', addDoc(collection(B, 'logs', 'uB', 'entries'), { at: 1, device: 'x', kind: 'today', key: '', action: 'edit' }));
await check('A cannot read B\'s log', getDocs(collection(A, 'logs', 'uB', 'entries')), false);
console.log(results.join('\n'));
await env.cleanup();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);

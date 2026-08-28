import { readFileSync } from 'node:fs';
const lines = readFileSync('/home/user/popmango-paperback-sources/common/Runtime.ts','utf8').split('\n');

// Slice each pure function out by its own line range, then drop the types.
function grab(startsWith) {
  const i = lines.findIndex(l => l.startsWith(startsWith));
  if (i < 0) throw new Error('not found: ' + startsWith);
  let j = i; while (lines[j] !== '}') j++;
  return lines.slice(i, j + 1).join('\n');
}
const strip = s => s
  .replace(/\(bytes: number\[\]\)/,'(bytes)').replace(/\(init: RequestInit\)/,'(init)')
  .replace(/\(record: Record<string, string> \| undefined\)/,'(record)')
  .replace(/\): string \| undefined \{/,') {').replace(/\): string \{/,') {')
  .replace(/let codePoint: number;/,'let codePoint;').replace(/let length: number;/,'let length;');

const code = [grab('function utf8Decode'), grab('function cacheKey'), grab('function pairs')].map(strip).join('\n');
const mod = await import('data:text/javascript,' + encodeURIComponent(
  `const REPLACEMENT="\\uFFFD";\n${code}\nexport {utf8Decode, cacheKey};`));
const { utf8Decode, cacheKey } = mod;
const R = '\uFFFD';

let fail = 0;
const t = (name, got, want) => { const ok = got === want; if (!ok) fail++;
  console.log(`${ok?'ok  ':'FAIL'}  ${name}${ok?'':`  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`); };

console.log('utf8Decode — the RangeError the audit found:');
// 0xF5 and each stray continuation byte are all unusable, so a conformant
// decoder emits one replacement per byte. The bug was that it threw at all.
try { t('  0xF5 lead byte -> replacements, no throw', utf8Decode([0xF5,0x80,0x80,0x80]), R.repeat(4)); }
catch (e) { fail++; console.log('FAIL  0xF5 still throws:', e.constructor.name, e.message); }
try { t('  broken continuation -> replacement', utf8Decode([0xE2,0x28,0xA1]), R+'('+R); }
catch (e) { fail++; console.log('FAIL  broken continuation threw:', e.constructor.name); }
t('  ascii round-trips', utf8Decode([...Buffer.from('hello')]), 'hello');
t('  accents round-trip', utf8Decode([...Buffer.from('Café')]), 'Café');
t('  CJK round-trips', utf8Decode([...Buffer.from('漫画')]), '漫画');
t('  emoji (4-byte) round-trips', utf8Decode([...Buffer.from('🔒')]), '🔒');

console.log('\ncacheKey — the collision that broke the OManga fallback:');
t('  same URL, different headers -> different keys',
  cacheKey({url:'https://s/x',headers:{rsc:'1'}}) !== cacheKey({url:'https://s/x'}), true);
t('  header order is irrelevant',
  cacheKey({url:'https://s/x',headers:{a:'1',b:'2'}}) === cacheKey({url:'https://s/x',headers:{b:'2',a:'1'}}), true);
t('  identical GETs still share', cacheKey({url:'https://s/x'}) === cacheKey({url:'https://s/x'}), true);
t('  POST is never cached', cacheKey({url:'https://s/x',method:'POST'}), undefined);
t('  a body is never cached', cacheKey({url:'https://s/x',body:'q=1'}), undefined);
t('  differing cookies -> different keys',
  cacheKey({url:'https://s/x',cookies:{a:'1'}}) !== cacheKey({url:'https://s/x'}), true);

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);

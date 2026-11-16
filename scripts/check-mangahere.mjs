/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

// Drives MangaHere through the calls the app makes, against a fake site that
// records every request, so what is checked is what the source asks the site
// for and what it hands the app back. The real common/ and src/MangaHere/ are
// transpiled into tmp/, where their packages still resolve, and the app's
// App.* factories hand back what they are given.

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const repo = process.cwd();
const require = createRequire(path.join(repo, 'package.json'));
const ts = require('typescript');
const out = path.join(repo, 'tmp', 'check-mangahere');
rmSync(out, { recursive: true, force: true });
for (const dir of ['common', 'src/MangaHere']) {
  mkdirSync(path.join(out, dir), { recursive: true });
  for (const file of readdirSync(path.join(repo, dir)).filter((f) => f.endsWith('.ts'))) {
    const { outputText } = ts.transpileModule(readFileSync(path.join(repo, dir, file), 'utf8'),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true } });
    writeFileSync(path.join(out, dir, file.replace(/\.ts$/, '.js')), outputText);
  }
}

// --- packed scripts ------------------------------------------------------------
// The site's packer: every word becomes a base-N code, the words go in a list.
// This packs test scripts the same way; the two answers below are the site's own.
const PACKER_BODY = 'eval(function(p,a,c,k,e,d){e=function(c){return(c<a?"":e(parseInt(c/a)))+((c=c%a)>35?String.fromCharCode(c+29):c.toString(36))};if(!\'\'.replace(/^/,String)){while(c--)d[e(c)]=k[c]||e(c);k=[function(e){return d[e]}];e=function(){return\'\\\\w+\'};c=1;};while(c--)if(k[c])p=p.replace(new RegExp(\'\\\\b\'+e(c)+\'\\\\b\',\'g\'),k[c]);return p;}';
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const encode = (n, radix) => (n < radix ? '' : encode(Math.floor(n / radix), radix)) + DIGITS[n % radix];
const pack = (source, radix = 62) => {
  const words = [...new Set(source.match(/\b\w+\b/g))];
  const payload = source.replace(/\b\w+\b/g, (word) => encode(words.indexOf(word), radix));
  const keywords = words.map((word, index) => (word === encode(index, radix) ? '' : word));
  const quoted = payload.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `${PACKER_BODY}('${quoted}',${radix},${words.length},'${keywords.join('|')}'.split('|'),0,{}))`;
};
// Onepunch-Man ch. 240, 2026-11-10: the reader's key script and its answer for page 1.
const REAL_KEY_SCRIPT = `${PACKER_BODY}('5 0=\\'\\'+\\'2\\'+\\'4\\'+\\'1\\'+\\'3\\'+\\'7\\'+\\'a\\'+\\'6\\'+\\'a\\'+\\'2\\'+\\'8\\'+\\'7\\'+\\'4\\'+\\'c\\'+\\'6\\'+\\'d\\'+\\'b\\';$("#9").e(0);',15,15,'guidkey|||||var||||dm5_key|||||val'.split('|'),0,{}))`;
const REAL_PAGE_ANSWER = `${PACKER_BODY}('g a(){2 c="//5.8.7/6/9/4/b.0/3";2 1=["/k.e","/l.e"];f(2 i=0;i<1.j;i++){h(i==0){1[i]="//5.8.7/6/9/4/b.0/3"+1[i];o}1[i]=c+1[i]}n 1}2 d;d=a();m=p;',26,26,'|pvalue|var|compressed|11912|zjcdn|store|org|mangahere|manga|dm5imagefun|240|pix||jpg|for|function|if||length|v001|v002|currentimageid|return|continue|47524828'.split('|'),0,{}))`;
const pageAnswer = (page, firstBase = '//img.test/store/manga/9/1.0/compressed') => pack(
  `function dm5imagefun(){var pix="//img.test/store/manga/9/1.0/compressed";var pvalue=["/p${page}.jpg","/p${page + 1}.jpg"];` +
  `for(var i=0;i<pvalue.length;i++){if(i==0){pvalue[i]="${firstBase}"+pvalue[i];continue}pvalue[i]=pix+pvalue[i]}return pvalue}var d;d=dm5imagefun();currentimageid=${page};`);
const keyScript = (key) => pack(`var guidkey=${[...key].map((c) => `'${c}'`).join('+')};$("#dm5_key").val(guidkey);`);

// --- the fake site -------------------------------------------------------------
const card = (id, { genres = [], chapter = 'c010', volume, score = '4.50', listClass = 1 } = {}) => {
  const ch = volume ? `v${volume}/${chapter}` : chapter;
  const tags = genres.map((g) => `<a>${g}</a>`).join('');
  return `<li><a href="/manga/${id}/" title="Title ${id}"><img class="manga-list-${listClass}-cover" src="http://cdn.test/${id}.jpg?token=t&amp;ttl=1"></a>` +
    `<p class="manga-list-${listClass}-item-title"><a href="/manga/${id}/" title="Title ${id}">Title ${id}</a></p>` +
    `<p class="manga-list-${listClass}-item-subtitle"><a href="/manga/${id}/${ch}/1.html" title="Ch.${chapter.slice(1)}">Ch.${chapter.slice(1)}</a></p>` +
    `<p class="manga-list-4-item-part"><a href="/manga/${id}/${ch}/1.html">Ch.${chapter.slice(1)}</a></p>` +
    `<div class="manga-list-4-show-tag-list">${tags}</div><span class="item-score">${score}</span>` +
    `<p class="manga-list-4-item-subtitle"><span>Nov 07,2026</span></p></li>`;
};
const pager = (more) => `<div class="pager-list-left">${more ? '<a href="/directory/2.htm">&gt;</a>' : '<a href="javascript:void(0)">&gt;</a>'}</div>`;
const homeBlock = (heading, ids) => `<div class="manga-list-1"><div class="manga-list-1-title">${heading}<a>More</a></div><ul>${ids.map((id) => card(id)).join('')}</ul></div>`;
const pages = {
  'https://www.mangahere.cc/': homeBlock('Recommended', ['rec1', 'rec2']) + homeBlock('New Manga Releases', ['new1']) +
    homeBlock('Being Read Right Now', ['read1']) + homeBlock('Hot Manga Releases', ['hot1']) + homeBlock('Trending Manga', ['tr1']),
  'https://newm.mangahere.cc/': '<div class="manga-list"><div class="manga-list-title">Trending Manga</div><ul class="manga-list-2">' +
    '<li><a href="/manga/tr1/" title="Title tr1"><img class="manga-list-2-cover-img" src="//cdn.test/tr1.jpg"></a><p class="manga-list-2-title"><a href="/manga/tr1/">Title tr1</a></p></li>' +
    '<li><a href="/manga/tr2/" title="Title tr2"><img class="manga-list-2-cover-img" src="//cdn.test/tr2.jpg"></a><p class="manga-list-2-title"><a href="/manga/tr2/">Title tr2</a></p></li></ul></div>',
  'https://www.mangahere.cc/latest/': `<ul class="manga-list-4-list">${card('late1', { listClass: 4 })}<li><p class="manga-list-4-item-title"><a href="/manga/nochapter/" title="No chapter">No chapter</a></p></li></ul>${pager(true)}`,
  'https://www.mangahere.cc/weekranking/': `<div class="weekrank"><ul class="manga-list-1-list">${card('w1')}${card('w2')}</ul></div><div class="dayrank"><ul class="manga-list-1-list">${card('d1')}</ul></div>`,
  'https://www.mangahere.cc/manga/kumo/': '<div class="detail-info"><img class="detail-info-cover-img" src="http://cdn.test/kumo.jpg">' +
    '<div class="detail-info-right"><span class="detail-info-right-title-font">Kumo &amp; Co</span><span class="detail-info-right-title-tip">Ongoing</span>' +
    '<span class="item-score">4.75</span><p class="detail-info-right-say"><a>Ann</a><a>Ann</a><a>Bo</a></p>' +
    '<p class="detail-info-right-tag-list"><a>Action</a><a>Slice of Life</a></p><p class="fullcontent">Line one.\n\n\n\nLine two.</p></div></div>' +
    '<ul class="detail-main-list">' +
    '<li><a href="/manga/kumo/vTBD/c012.5/1.html" title="Kumo Ch.012.5"><p class="title3">Vol.TBD Ch.012.5</p><p class="title2">3 hours ago</p></a></li>' +
    '<li><a href="/manga/kumo/v02/c012/1.html" title="Kumo Ch.012"><p class="title3">Vol.02 Ch.012 - Rain</p><p class="title2">Nov 07,2026</p></a></li>' +
    '<li><a href="/manga/kumo/v02/c012/1.html"><p class="title3">Vol.02 Ch.012 - Rain</p></a></li>' +
    '<li><a href="/manga/kumo/c000/1.html" title="Kumo Oneshot"><p class="title3">Oneshot</p><p class="title2">Yesterday</p></a></li></ul>',
  'https://www.mangahere.cc/manga/lewd/': '<div class="detail-info"><div class="detail-info-right"><span class="detail-info-right-title-font">Lewd</span>' +
    '<span class="detail-info-right-title-tip">Completed</span><p class="detail-info-right-tag-list"><a>Adult</a></p></div></div>',
  'https://m.mangahere.cc/roll_manga/kumo/v02/c012/1.html': '<div id="viewer"><img src="//m.test/loading.gif" data-original="http://img.test/store/manga/9/012.0/compressed/p001.jpg?token=a&amp;ttl=1">' +
    '<img data-original="//img.test/store/manga/9/012.0/compressed/p002.jpg"><img data-original="//img.test/store/manga/9/012.0/compressed/p002.jpg"><img src="//m.test/ad.png"></div>',
  'https://m.mangahere.cc/roll_manga/licensed/c001/1.html': '<div class="mangaread-main">This series has been licensed, it is not available in MangaHere.</div>',
  'https://www.mangahere.cc/manga/licensed/c001/1.html': `<script>var chapterid =555;var imagecount=3;</script><script>${keyScript('k3y')}</script>`,
  'https://m.mangahere.cc/roll_manga/stale/c001/1.html': '<p>licensed</p>',
  'https://www.mangahere.cc/manga/stale/c001/1.html': `<script>var chapterid =556;var imagecount=2;</script><script>${keyScript('old')}</script>`,
  'https://m.mangahere.cc/roll_manga/strip/c001/1.html': '<p>licensed</p>',
  'https://www.mangahere.cc/manga/strip/c001/1.html': `<script src="//static.test/chapter_bar.js"></script><script>var chapterid =557;var imagecount=2;</script>` +
    `<script>${pack("var newImgs=['//img.test/s/1.jpg',\"http://img.test/s/2.jpg\"];var x=1;")}</script>`,
  'https://m.mangahere.cc/roll_manga/gone/c001/1.html': '<p>licensed</p>',
  'https://www.mangahere.cc/manga/gone/c001/1.html': `<script src="//static.test/chapter_bar.js"></script><script>var chapterid =558;var imagecount=1;</script>` +
    `<script>${pack("var newImgs=['//www.mangahere.cc/images/war.jpg'];")}</script>`,
};
const site = { requests: [], challengeOn: undefined, emptyAnswers: new Set() };
const respond = (request) => {
  const url = request.url;
  site.requests.push({ url, headers: request.headers, cookies: Object.fromEntries((request.cookies ?? []).map((c) => [c.name, c.value])) });
  const html = (data, status = 200) => ({ status, headers: { 'content-type': 'text/html; charset=utf-8' }, data, request });
  if (site.challengeOn !== undefined && url.startsWith(site.challengeOn)) {
    return { status: 403, headers: { 'cf-mitigated': 'challenge', 'content-type': 'text/html' }, data: '<title>Just a moment...</title>', request };
  }
  const fun = /\/manga\/([^/]+)\/c001\/chapterfun\.ashx\?cid=(\d+)&page=(\d+)&key=(\w*)$/.exec(url);
  if (fun) {
    const [, manga, , page, key] = fun;
    if (site.emptyAnswers.has(`${manga}:${key}`)) return { status: 200, headers: { 'content-type': 'text/javascript' }, data: '', request };
    return { status: 200, headers: { 'content-type': 'text/javascript' }, data: pageAnswer(Number(page)), request };
  }
  if (pages[url] !== undefined) return html(pages[url]);
  if (/^https:\/\/www\.mangahere\.cc\/(?:directory|romance|completed|on_going|adult)\/|\/search\?/.test(url)) {
    return html(`<ul class="manga-list-1-list">${card('safe1', { genres: ['Romance'] })}${card('mature1', { genres: ['Ecchi'] })}${card('adult1', { genres: ['Adult'] })}</ul>` +
      `<ul class="manga-list-4-list">${card('one_piece', { listClass: 4 })}${card('piece', { listClass: 4 })}${card('bare', { listClass: 4 }).replace(/<div class="manga-list-4-show-tag-list">.*?<\/div>/, '')}</ul>${pager(true)}`);
  }
  return html('<h1>Not Found</h1>', 404);
};

// One store for every instance, so a new instance is the app after a restart.
const state = new Map();
globalThis.App = new Proxy({
  createSourceStateManager: () => ({ retrieve: async (key) => state.get(key), store: async (key, value) => { state.set(key, value); } }),
  // As on a device; nothing here should need it.
  createRawData: () => null,
  createRequestManager: ({ interceptor }) => ({
    getDefaultUserAgent: async () => 'Test',
    schedule: async (request) => interceptor.interceptResponse(respond(await interceptor.interceptRequest(request))),
  }),
}, { get: (stubs, name) => stubs[name] ?? ((value) => value) });

const load = (file) => require(path.join(out, file));
const cheerio = require('cheerio');
const { MangaHere, MangaHereInfo } = load('src/MangaHere/MangaHere.js');
const { unpack, parseReaderKey, parsePageImage, parseEmbeddedPages } = load('src/MangaHere/unpack.js');
const { SETTINGS_KEYS, SHOW_ADULT_KEY } = load('src/MangaHere/models.js');
const { Application, CloudflareError } = load('common/index.js');

let fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};
const rejects = async (fn) => { try { await fn(); return undefined; } catch (error) { return error; } };
// Each check starts with nothing remembered from the last one.
const fresh = () => { Application.inFlight.clear(); site.requests = []; site.challengeOn = undefined; site.emptyAnswers.clear(); };
const asked = () => site.requests.map((r) => r.url);
const tag = (id) => ({ id, label: id });
const search = async (instance, { title = '', include = [], exclude = [], parameters = {} } = {}, metadata) => {
  fresh();
  const page = await instance.getSearchResults({ title, includedTags: include.map(tag), excludedTags: exclude.map(tag), parameters }, metadata);
  return { page, url: asked().at(-1), titles: page.results.map((r) => r.title) };
};
const source = () => new MangaHere(cheerio);

// --- unpacking -----------------------------------------------------------------
console.log('the desktop reader\'s packed scripts, read as text:');
t('the site\'s key script gives its key', parseReaderKey(unpack(REAL_KEY_SCRIPT)), '24137a6a2874c6db');
t('the site\'s page answer gives the page asked for', parsePageImage(unpack(REAL_PAGE_ANSWER)), '//zjcdn.mangahere.org/store/manga/11912/240.0/compressed/v001.jpg');
{
  const script = 'var a00="x\'y\\\\z";var list=["one","two"];' + Array.from({ length: 80 }, (_, i) => `var w${i}=${i};`).join('');
  t('a packed script with escapes, a leading-zero word and 2-digit codes unpacks exactly', unpack(pack(script)), script);
  t('the same in base 36', unpack(pack(script, 36)), script);
}
// The packer replaces \b0\b, which never matches inside "00".
t('a word with a leading zero is a word, not a code', unpack(`${PACKER_BODY}('0 00 1',62,2,'first|second'.split('|'),0,{}))`), 'first 00 second');
t('the first page takes the base its answer gives it', parsePageImage(unpack(pageAnswer(4, '//other.test/base'))), '//other.test/base/p4.jpg');
t('an embedded list keeps both quote styles', parseEmbeddedPages(unpack(pack("var newImgs=['//a/1.jpg',\"//a/2.jpg\"];"))), ['//a/1.jpg', '//a/2.jpg']);
t('a script that is not packed is refused, not run', (await rejects(async () => unpack('eval("alert(1)")')))?.message, 'The reader script is not packed in a form this source can read.');
t('a key built from anything but literals is refused', (await rejects(async () => parseReaderKey("var guidkey=''+window.k;")))?.message, 'The reader key is built in a way this source cannot read.');

// --- home page -----------------------------------------------------------------
console.log('\nthe home page:');
{
  const instance = source();
  fresh();
  const sections = [];
  await instance.getHomePageSections((section) => sections.push(section));
  const rows = new Map(sections.map((s) => [s.id, s]));
  t('rows, in the site\'s order, with its genre and ranking strips left out', [...rows.keys()], ['popular', 'recommended', 'new', 'latest', 'reading-now', 'trending', 'hot']);
  t('the front page is asked for once for all its rows', asked().filter((u) => u === 'https://www.mangahere.cc/').length, 1);
  t('front page rows', ['recommended', 'new', 'reading-now', 'hot'].map((id) => rows.get(id).items.map((i) => i.mangaId)), [['rec1', 'rec2'], ['new1'], ['read1'], ['hot1']]);
  t('tiles carry the newest chapter and rating, with https covers', rows.get('recommended').items[0], { mangaId: 'rec1', title: 'Title rec1', image: 'https://cdn.test/rec1.jpg?token=t&ttl=1', subtitle: 'Ch. 10 • ★ 4.50' });
  t('trending comes from the mobile site, with the front page\'s chapter', rows.get('trending').items.map((i) => [i.mangaId, i.subtitle ?? null, i.image]), [['tr1', 'Ch. 10', 'https://cdn.test/tr1.jpg'], ['tr2', null, 'https://cdn.test/tr2.jpg']]);
  t('latest skips entries with no chapter and pages on', [rows.get('latest').items.map((i) => i.mangaId), rows.get('latest').containsMoreItems], [['late1'], true]);
  fresh();
  const more = await instance.getViewMoreItems('popular', { page: 2 });
  t('popular page 2', [asked(), more.metadata], [['https://www.mangahere.cc/directory/2.htm?po'], { page: 3 }]);
}

// --- search --------------------------------------------------------------------
console.log('\nsearch, as the site\'s own filters send it:');
{
  const instance = source();
  let s = await search(instance, { title: 'piece' });
  t('a title alone uses the plain search, in the site\'s order', [s.url, s.titles], ['https://www.mangahere.cc/search?title=piece', ['Title one_piece', 'Title piece', 'Title bare']]);
  s = await search(instance, { title: 'title PIECE' });
  t('an exact title match comes first, whatever its place on the page', s.titles, ['Title piece', 'Title one_piece', 'Title bare']);
  s = await search(instance, { include: ['genre::9'] });
  t('one genre browses the directory, popular first', s.url, 'https://www.mangahere.cc/romance/?po');
  s = await search(instance, { include: ['genre::9', 'sort::az', 'status::2'] }, { page: 2 });
  t('a genre, an order and a state are the directory\'s path', s.url, 'https://www.mangahere.cc/romance/completed/2.htm?az');
  s = await search(instance, { include: ['status::1'] });
  t('a state alone is a path too', s.url, 'https://www.mangahere.cc/on_going/?po');
  s = await search(instance, { include: ['genre::9', 'genre::3'], exclude: ['genre::22', 'type::1'] });
  t('two genres and an exclusion use the search, a non-genre exclusion is ignored', s.url, 'https://www.mangahere.cc/search?genres=9%2C3&nogenres=22&stype=1');
  s = await search(instance, { title: 'kumo', include: ['type::2', 'nameMatch::bw', 'sort::az'] });
  t('a filter turns the title into the advanced form\'s name', s.url, 'https://www.mangahere.cc/search?name=kumo&name_method=bw&type=2&stype=1');
  s = await search(instance, { include: ['authorMatch::ew', 'releasedMatch::lt', 'stars::4', 'starsMatch::gt', 'status::2'], parameters: { author: ' Oda ', artist: '', released: '2015' } });
  t('typed fields and their match choices', s.url, 'https://www.mangahere.cc/search?author=Oda&author_method=ew&rating=4&rating_method=gt&released=2015&released_method=lt&st=2&stype=1');
  s = await search(instance, { include: ['ranking::weekly', 'genre::9'], title: 'x' });
  t('a ranking ignores the other filters and keeps its order', [s.url, s.page.results.map((r) => [r.mangaId, r.subtitle])], ['https://www.mangahere.cc/weekranking/', [['w1', '#1 • Ch. 10 • ★ 4.50'], ['w2', '#2 • Ch. 10 • ★ 4.50']]]);
  s = await search(instance, { title: 'https://m.mangahere.cc/manga/kumo/' });
  t('a pasted series URL opens that series', [s.url, s.page.results.map((r) => [r.mangaId, r.title]), s.page.metadata], ['https://www.mangahere.cc/manga/kumo/', [['kumo', 'Kumo & Co']], undefined]);
  s = await search(instance, { title: 'kumo' });
  t('search pages on while the site has a next page', s.page.metadata, { page: 2 });
  s = await search(instance, { title: 'kumo' }, { page: 3 });
  t('page 3 of a search', s.url, 'https://www.mangahere.cc/search?page=3&title=kumo');
}

// --- adult titles --------------------------------------------------------------
console.log('\nthe adult-title setting:');
{
  t('its key is declared, so it is read before anything needs it', SETTINGS_KEYS.includes(SHOW_ADULT_KEY), true);
  const instance = source();
  let s = await search(instance, { include: ['genre::31'] });
  t('shown by default, as the site does', s.page.results.map((r) => r.mangaId), ['safe1', 'mature1', 'adult1']);
  instance.settings.set(SHOW_ADULT_KEY, false);
  s = await search(instance, { include: ['genre::31'] });
  t('hidden once turned off; mature titles stay', s.page.results.map((r) => r.mangaId), ['safe1', 'mature1']);
  s = await search(instance, { title: 'x', include: ['genre::31', 'genre::9'] });
  t('a card without genres takes the rating of the genres searched for', s.page.results.map((r) => r.mangaId), []);
  const restarted = source();
  await restarted.settings.load();
  t('the choice survives a restart', restarted.settings.boolean(SHOW_ADULT_KEY, true), false);
  restarted.settings.set(SHOW_ADULT_KEY, true);
  t('takes over the other repository\'s 3.0.5 in place', MangaHereInfo.version, '3.0.6');
}

// --- details and chapters -------------------------------------------------------
console.log('\nthe details page and the chapter list:');
{
  const instance = source();
  fresh();
  const details = await instance.getMangaDetails('kumo');
  const info = details.mangaInfo;
  t('details', [info.titles, info.image, info.status, info.rating, info.author, info.desc, info.hentai, info.tags[0].tags.map((x) => x.id)],
    [['Kumo & Co'], 'https://cdn.test/kumo.jpg', 'Ongoing', 0.95, 'Ann, Bo', 'Line one.\n\nLine two.', false, ['action', 'slice-of-life']]);
  t('an adult genre sets the hentai flag', (await instance.getMangaDetails('lewd')).mangaInfo.hentai, true);
  fresh();
  const chapters = await instance.getChapters('kumo');
  t('the list reuses the details page, asked for once', asked(), ['https://www.mangahere.cc/manga/kumo/']);
  t('chapters keep their volume, fractional numbers, and newest-first order', chapters.map((c) => [c.id, c.chapNum, c.volume, c.sortingIndex, c.name ?? null]),
    [['vTBD/c012.5', 12.5, 0, 4, null], ['v02/c012', 12, 2, 3, null], ['c000', 0, 0, 1, 'Oneshot']]);
  t('dates', chapters.map((c) => c.time instanceof Date), [true, true, true]);
  t('a listing repeat is dropped', chapters.length, 3);
  t('ids match the other repository\'s, so saved titles carry over', chapters.map((c) => c.id), ['vTBD/c012.5', 'v02/c012', 'c000']);
}

// --- pages ----------------------------------------------------------------------
console.log('\nreading a chapter:');
{
  const instance = source();
  await instance.getChapters('kumo');
  fresh();
  let details = await instance.getChapterDetails('kumo', 'v02/c012');
  t('the mobile reader gives the whole chapter in one request', asked(), ['https://m.mangahere.cc/roll_manga/kumo/v02/c012/1.html']);
  t('real images, not the loading picture, https, each once, in order', details.pages, [
    'https://img.test/store/manga/9/012.0/compressed/p001.jpg?token=a&ttl=1', 'https://img.test/store/manga/9/012.0/compressed/p002.jpg']);

  const restarted = source();
  fresh();
  details = await restarted.getChapterDetails('licensed', 'c001');
  t('after a restart, a chapter opens without fetching its list', asked()[0], 'https://m.mangahere.cc/roll_manga/licensed/c001/1.html');
  t('a licensed title falls back to the desktop reader, one request per page', asked().slice(1), [
    'https://www.mangahere.cc/manga/licensed/c001/1.html',
    ...[1, 2, 3].map((p) => `https://www.mangahere.cc/manga/licensed/c001/chapterfun.ashx?cid=555&page=${p}&key=k3y`)]);
  t('each answer gives its own page', details.pages, [1, 2, 3].map((p) => `https://img.test/store/manga/9/1.0/compressed/p${p}.jpg`));
  const pageRequests = site.requests.filter((r) => r.url.includes('chapterfun'));
  t('page requests name their chapter as referer', [...new Set(pageRequests.map((r) => r.headers.referer))], ['https://www.mangahere.cc/manga/licensed/c001/1.html']);
  t('and ask as the site\'s script does', [...new Set(pageRequests.map((r) => r.headers['x-requested-with']))], ['XMLHttpRequest']);

  fresh();
  site.emptyAnswers.add('stale:old');
  details = await restarted.getChapterDetails('stale', 'c001').catch((error) => ({ pages: [], error: error.message }));
  t('an empty answer is asked again once, with an empty key as the site sends it',
    [details.error ?? null, details.pages.length, asked().filter((u) => u.includes('key=old')).length, asked().filter((u) => u.endsWith('key=')).length], [null, 2, 2, 2]);
  fresh();
  site.emptyAnswers.add('stale:old');
  site.emptyAnswers.add('stale:');
  t('a reader that never answers is an error, not a short chapter', (await rejects(() => restarted.getChapterDetails('stale', 'c001')))?.message, 'The reader did not answer for page 1.');
  t('and is not asked a third time', asked().filter((u) => u.includes('page=1&')).length, 2);

  fresh();
  details = await restarted.getChapterDetails('strip', 'c001');
  t('a reader that lists its own pages needs no page requests', [details.pages, asked().filter((u) => u.includes('chapterfun')).length], [['https://img.test/s/1.jpg', 'https://img.test/s/2.jpg'], 0]);
  fresh();
  t('a removed chapter says so', (await rejects(() => restarted.getChapterDetails('gone', 'c001')))?.message, 'This chapter\'s images have been removed from the site.');

  fresh();
  site.challengeOn = 'https://m.mangahere.cc/';
  const challenge = await rejects(() => restarted.getChapterDetails('kumo', 'v02/c012'));
  t('a challenge on the mobile reader goes to the app, not the fallback', [challenge instanceof CloudflareError, asked().length], [true, 1]);
  fresh();
  t('a chapter missing on both readers is an error', typeof (await rejects(() => restarted.getChapterDetails('nowhere', 'c001')))?.message, 'string');
}

// --- requests -------------------------------------------------------------------
console.log('\nwhat every request carries:');
{
  const instance = source();
  fresh();
  await instance.getMangaDetails('kumo');
  const sent = site.requests[0];
  t('the age prompt is answered with cookies', [sent.cookies.isAdult, sent.cookies.MHNMM], ['1', '1']);
  t('a site page names the site as referer', sent.headers.referer, 'https://www.mangahere.cc/');
  // The app loads page images through the same interceptor.
  const { MangaHereInterceptor } = load('src/MangaHere/network.js');
  const image = await new MangaHereInterceptor().interceptRequest({
    url: 'http://img.test/store/manga/1/p1.jpg?token=a', method: 'GET', headers: { referer: 'https://elsewhere.test/' }, cookies: {} });
  t('an http image is asked for over https, with the site root as referer', [image.url, image.headers.referer], ['https://img.test/store/manga/1/p1.jpg?token=a', 'https://www.mangahere.cc/']);
  const protocolRelative = await new MangaHereInterceptor().interceptRequest({ url: '//img.test/p.png', method: 'GET', headers: {}, cookies: {} });
  t('so is a protocol-relative one', protocolRelative.url, 'https://img.test/p.png');
  fresh();
  site.challengeOn = 'https://www.mangahere.cc/manga/';
  t('a challenge is reported as one', (await rejects(() => instance.getMangaDetails('kumo'))) instanceof CloudflareError, true);
}

if (fail > 0) {
  console.error(`\n${fail} MangaHere check(s) failed.`);
  process.exit(1);
}
console.log('\nAll MangaHere checks passed.');

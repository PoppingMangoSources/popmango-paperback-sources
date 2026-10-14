/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

// Exercises the XCOMIC parsers against the real source files: they are copied
// out, compiled with tsc, and run with the shared runtime stubbed by Node's own
// equivalents, so what runs here is the code that ships.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repo = process.cwd();
const out = mkdtempSync(path.join(tmpdir(), 'xcomic-check-'));
const built = path.join(out, 'built');

// The real HTML parser and entity decoder, loaded from the repository.
const fromRepo = createRequire(path.join(repo, 'package.json'));
const cheerioPath = fromRepo.resolve('cheerio');
const entitiesPath = fromRepo.resolve('html-entities');

writeFileSync(path.join(out, 'stub.ts'), `
// @ts-nocheck
import { createRequire } from "node:module";
const require = createRequire(${JSON.stringify(path.join(repo, 'package.json'))});
const cheerio = require(${JSON.stringify(cheerioPath)});
const { decode } = require(${JSON.stringify(entitiesPath)});
export enum ContentRating { EVERYONE = "EVERYONE", MATURE = "MATURE", ADULT = "ADULT" }
export enum DiscoverSectionType {
  featured = "featured", simpleCarousel = "simpleCarousel", prominentCarousel = "prominentCarousel",
  chapterUpdates = "chapterUpdates", genres = "genres",
}
export const Application = {
  decodeHTMLEntities: (value: string) => decode(value),
  loadDocument: (html: string) => cheerio.load(html),
};
export type Tag = any; export type TagSection = any; export type Chapter = any;
export type ChapterDetails = any; export type DiscoverSectionItem = any; export type DiscoverSection = any;
export type SearchResultItem = any; export type SourceManga = any;
`);

for (const file of ['models.ts', 'parsers.ts']) {
  writeFileSync(
    path.join(out, file),
    readFileSync(path.join(repo, 'src/XCOMIC', file), 'utf8').replace(/["']\.\.\/\.\.\/common["']/g, '"./stub"'),
  );
}

try {
  execFileSync('npx', ['tsc', ...['stub.ts', 'models.ts', 'parsers.ts'].map((f) => path.join(out, f)),
    '--outDir', built, '--rootDir', out, '--module', 'esnext', '--target', 'es2020',
    '--moduleResolution', 'bundler', '--strict', 'false', '--skipLibCheck', '--types', 'node'],
    { stdio: 'pipe' });
} catch (error) {
  console.log(String(error.stdout ?? error));
  process.exit(1);
}

for (const file of ['models.js', 'parsers.js']) {
  const at = path.join(built, file);
  writeFileSync(at, readFileSync(at, 'utf8').replace(/(from\s+["']\.\/[A-Za-z]+)(["'])/g, '$1.js$2'));
}

const p = await import(path.join(built, 'parsers.js'));

let fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};

const prefs = (over = {}) => ({
  contentRatings: ['safe', 'suggestive', 'erotica', 'pornographic'],
  excludedFormats: [], excludedGenres: [], originalLanguages: [], translatedLanguages: ['en'],
  types: ['cartoon', 'imageset', 'manga', 'manhua', 'manhwa', 'oel', 'other', 'western'],
  ...over,
});
const comic = (over = {}) => ({ id: 'c1', name: 'A Title', urlCover: '/cover.jpg', type: 'manhwa', ...over });

// --- editions ---------------------------------------------------------------
console.log('toTitleSources — choosing and ordering editions:');
{
  const title = {
    data: comic({ id: 't1', name: 'The Work' }),
    comicNodes: [
      { data: { id: 'fr1', name: 'The Work', subName: 'FR Team', translatedLanguage: 'fr', chaps_normal: 99 } },
      { data: { id: 'en1', name: 'The Work', subName: 'Small', translatedLanguage: 'en', chaps_normal: 5 } },
      { data: { id: 'en2', name: 'The Work', subName: 'Big', translatedLanguage: 'en', chaps_normal: 40 } },
      { data: { id: 'xx1', name: 'The Work', subName: 'Unlabelled', chaps_normal: 1 } },
      null,
    ],
  };
  const ids = p.toTitleSources(title, ['en']).map((s) => s.data.id);
  t('  reader language first, then most chapters; unlabelled kept, other languages dropped', ids, ['en2', 'en1', 'xx1']);
  t('  the preferred edition is the fullest in the reader language',
    p.toPreferredTitleSource(title, ['en']).data.id, 'en2');
  t('  an edition inherits the title cover', p.toTitleSources(title, ['en'])[0].data.urlCover, '/cover.jpg');
  t('  no language preference keeps everything',
    p.toTitleSources(title, []).length, 4);

  const twins = {
    data: comic({ id: 't2' }),
    comicNodes: [
      { data: { id: 'a', name: 'Twin', subName: 'Same Team', translatedLanguage: 'en', chaps_normal: 9 } },
      { data: { id: 'b', name: 'Twin', subName: 'same team', translatedLanguage: 'en', chaps_normal: 3 } },
    ],
  };
  t('  editions sharing a team name are told apart by id',
    p.toTitleSources(twins, ['en']).map((s) => s.data.subName), ['Same Team [a]', 'same team [b]']);
}

// --- filtering --------------------------------------------------------------
console.log('\nisComicAllowed — what the reader has ruled out:');
{
  t('  an ordinary title passes', p.isComicAllowed(comic(), prefs()), true);
  t('  no cover is never shown', p.isComicAllowed(comic({ urlCover: '' }), prefs()), false);
  t('  a remote cover counts', p.isComicAllowed(comic({ urlCover: null, remoteCoverUrl: 'https://x/c.jpg' }), prefs()), true);
  t('  an excluded genre hides it', p.isComicAllowed(comic({ genres: ['gore'] }), prefs({ excludedGenres: ['gore'] })), false);
  t('  a legacy format id still matches an exclusion',
    p.isComicAllowed(comic({ tags: ['long_strip'] }), prefs({ excludedFormats: ['longstrip'] })), false);
  t('  a type outside the chosen ones hides it', p.isComicAllowed(comic({ type: 'manga' }), prefs({ types: ['manhwa'] })), false);
  t('  a legacy type maps onto its replacement', p.isComicAllowed(comic({ type: 'novel' }), prefs({ types: ['other'] })), true);
  t('  a hentai genre reads as pornographic',
    p.isComicAllowed(comic({ genres: ['hentai'] }), prefs({ contentRatings: ['safe', 'suggestive'] })), false);
  t('  an unknown rating is gated at the top',
    p.isComicAllowed(comic({ contentRating: 'brand-new' }), prefs({ contentRatings: ['safe'] })), false);
  t('  a wrong translated language hides it',
    p.isComicAllowed(comic({ translatedLanguages: ['fr'] }), prefs()), false);
  t('  no stated language is no reason to hide it',
    p.isComicAllowed(comic({ translatedLanguages: [] }), prefs()), true);
  t('  original language is enforced when set',
    p.isComicAllowed(comic({ originalLanguage: 'ja' }), prefs({ originalLanguages: ['ko'] })), false);
}

// --- titles and cards --------------------------------------------------------
console.log('\nXComicParser — titles and cards:');
{
  const shown = new p.XComicParser({ baseUrl: 'https://yona.to', showEditionInTitle: true });
  const hidden = new p.XComicParser({ baseUrl: 'https://yona.to', showEditionInTitle: false });

  t('  the edition is appended when asked',
    shown.searchResult({ data: comic({ subName: 'Team X' }) }).title, 'A Title (Team X)');
  t('  and left off when not',
    hidden.searchResult({ data: comic({ subName: 'Team X' }) }).title, 'A Title');
  t('  an importer marker is stripped from the name',
    shown.searchResult({ data: comic({ name: 'Work [src-site:mfx]' }) }).title, 'Work');
  t('  a team already in the name is not repeated',
    shown.searchResult({ data: comic({ name: 'Work [Good Scans]' }) }).title, 'Work [Good Scans]');
  t('  covers resolve against the active mirror',
    shown.searchResult({ data: comic() }).imageUrl, 'https://yona.to/cover.jpg');
  t('  entities in a title are decoded',
    hidden.searchResult({ data: comic({ name: 'Tom &amp; Jerry' }) }).title, 'Tom & Jerry');
  t('  the card subtitle names chapters and type',
    hidden.searchResult({ data: comic({ totalChapters: 1234, type: 'oel' }) }).subtitle, '1,234 Chapters • OEL');

  const ranked = (metric, extra) => hidden.rankedItems([{ data: comic(extra) }], metric)[0];
  t('  top rated shows chapters and score',
    ranked('top', { totalChapters: 12, score_val: 8.66 }).subtitle, '12 Chapters • ★ 8.7');
  t('  most followed shows follows', ranked('follows', { follows: 25000 }).subtitle, '♥ 25,000 Follows');
  t('  most reviewed shows reviews', ranked('reviews', { reviews: 7 }).subtitle, '7 Reviews');
  t('  most chapters is a plain strip', ranked('chapters', { totalChapters: 3 }).type, 'simpleCarouselItem');

  const update = {
    data: comic({ chapterNodes_last: [{ data: { id: '55', urlPath: '/comic/x/chapter/55-ch-3', chaNum: 3, datePublic: 1700000000 } }] }),
  };
  const [item] = hidden.discoverItems([update], 'chapterUpdatesCarouselItem');
  t('  a chapter update carries its chapter id', item.chapterId, '/comic/x/chapter/55-ch-3');
  t('  and reads a timestamp in seconds', item.publishDate.toISOString(), '2023-11-14T22:13:20.000Z');
  t('  an update with no chapter is skipped',
    hidden.discoverItems([{ data: comic() }], 'chapterUpdatesCarouselItem').length, 0);
}

// --- details and chapters ----------------------------------------------------
console.log('\nsourceManga and chapter — details feeding the chapter list:');
{
  const parser = new p.XComicParser({ baseUrl: 'https://xcomic.me', showEditionInTitle: false });
  const manga = parser.sourceManga({
    data: comic({
      id: 'm1', name: 'Work [Night Owls]', translatedLanguage: 'pt_br', originalLanguage: 'ko',
      originalStatus: 'releasing', score_val: 9, genres: ['action', 'silver_golden'],
      summary: { html: '<p>One</p><p>Two</p>' },
      authorNodes: [{ data: { name: 'Ann' } }], artistNodes: [{ data: { name: 'Ann' } }, { data: { name: 'Bo' } }],
    }),
  });
  t('  releasing reads as Ongoing', manga.mangaInfo.status, 'Ongoing');
  t('  a score out of ten becomes a fraction', manga.mangaInfo.rating, 0.9);
  t('  the synopsis keeps its paragraphs', manga.mangaInfo.synopsis, 'One\nTwo');
  t('  an artist who is also the author is not repeated', manga.mangaInfo.artist, 'Bo');
  t('  tag titles use the overrides', manga.mangaInfo.tagGroups[0].tags.map((tag) => tag.title), ['Action', 'Silver & Golden']);
  t('  the team rides in the details', manga.mangaInfo.additionalInfo.Team, 'Night Owls');
  t('  so does the language, by name', manga.mangaInfo.additionalInfo['Translated Language'], 'Portuguese (BR)');

  const chapter = parser.chapter(
    { id: '9', dname: 'Chapter 4', title: 'Chapter 4', chaNum: 4, srcName: 'aggregator', urlPath: '/c/9-x' },
    manga,
  );
  t('  the edition team names the group, not the aggregator', chapter.group, 'Night Owls');
  t('  the language code is recovered from the name', chapter.langCode, 'pt-br');
  t('  a title equal to the name is not repeated', chapter.title, 'Chapter 4');
  t('  the chapter number is read', chapter.chapNum, 4);

  const bare = parser.sourceManga({ data: comic({ id: 'm2', translatedLanguage: '_t' }) });
  const other = parser.chapter({ id: '1', srcName: 'mangadex' }, bare);
  t('  the catch-all language becomes und', other.langCode, 'und');
  t('  with no team the source is named instead', other.group, 'Mangadex');

  t('  page urls resolve against the mirror',
    parser.chapterDetails({ get_chapterNode: { data: { imageUrls: ['/p/1.webp', 'https://cdn/2.webp', ''] } } },
      { chapterId: 'c', sourceManga: { mangaId: 'm' } }).pages,
    ['https://xcomic.me/p/1.webp', 'https://cdn/2.webp']);
  let threw = false;
  try { parser.chapterDetails({ get_chapterNode: { data: { imageUrls: [] } } }, { chapterId: 'c', sourceManga: { mangaId: 'm' } }); }
  catch { threw = true; }
  t('  a chapter with no pages is an error, not an empty reader', threw, true);
}

// --- the upload feed ----------------------------------------------------------
console.log('\ntoLatestUploadNodes — flattening the upload feed:');
{
  const node = (id, date, status = 'normal', cover = '/c.jpg') => ({
    data: { id, datePublic: date, dbStatus: status, comicNode: { data: comic({ id: `m${id}`, urlCover: cover }) } },
  });
  const nodes = p.toLatestUploadNodes({
    items: [{ chapters: [node('1', 100), node('2', 300), node('3', 200, 'deleted'), node('4', 400, 'normal', '')] }],
  });
  t('  newest first, removals and coverless titles dropped', nodes.map((n) => n.data.id), ['m2', 'm1']);
  let threw = false;
  try { p.toLatestUploadNodes(null); } catch { threw = true; }
  t('  a missing feed is an error rather than an empty row', threw, true);
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);

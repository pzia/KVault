import assert from 'node:assert/strict';
import { filterPurchases, compareAuthor, filterComparison, isBookMarkedRead, setBookReadState, mergeVaults, toCsv, dedupe, authorMatches, sortBooks, publicationYear, topAuthors, compareCatalog, parseFreeSearch, freeSearchMatches } from '../public/model.js';

const owned = [
  { title:'La Main gauche de la nuit', authors:['Ursula K. Le Guin'], language:'fr-FR', isbn:'9780001', mediaType:'ebook', publicationDate:'1969-03-01', averageRating:4.5, ratingCount:1200 },
  { title:'A Wizard of Earthsea', authors:['Ursula K. Le Guin'], language:'en', isbn:'9780002', mediaType:'ebook', publicationDate:'1968-01-01', averageRating:4.0, ratingCount:800 },
  { title:'Dune', authors:['Frank Herbert'], language:'fr', isbn:'9780003', mediaType:'ebook', publicationDate:'1965', averageRating:4.8, ratingCount:5000 },
  { title:'Coécrit', authors:['Ken Follett','Jane Doe'], language:'fr', isbn:'9780006', mediaType:'ebook', publicationDate:'2024-09-05' }
];

assert.equal(filterPurchases(owned, { search:'le guin' }).length, 2);
assert.equal(filterPurchases(owned, { search:'main gauche', language:'fr' }).length, 1);
assert.equal(filterPurchases(owned, { language:'en', mediaType:'ebook' }).length, 1);

// Matching auteur strict : tolère typo légère et ordre Nom, Prénom, refuse prénom partiel.
assert.equal(authorMatches('Ken Follet', 'Ken Follett'), true);
assert.equal(authorMatches('Ken Follet', 'Follett, Ken'), true);
assert.equal(authorMatches('Ken Follet', 'Ken'), false);
assert.equal(authorMatches('Ken Follet', 'Ken Burns'), false);
assert.equal(authorMatches('Ken Follet', 'John Doe + Ken'), false);
assert.equal(authorMatches('Ursula K. Le Guin', 'Le Guin, Ursula K.'), true);

const catalog = [
  { title:'La Main gauche de la nuit', authors:['Ursula K. Le Guin'], language:'fr', isbn:'9780001', publicationDate:'1969-03-01' },
  { title:'Les Dépossédés', authors:['Ursula K. Le Guin'], language:'fr', isbn:'9780004', publicationDate:'1974-05-01' },
  { title:'Lavinia', authors:['Ursula K. Le Guin'], language:'fr', isbn:'9780005', publicationDate:'2008-04-21' },
  { title:'Dune', authors:['Frank Herbert'], language:'fr', isbn:'9780003', publicationDate:'1965' },
  { title:'Faux positif', authors:['Ken'], language:'fr', isbn:'9780007', publicationDate:'2020' }
];

let states = setBookReadState({}, catalog[2], true, '2026-02-01T00:00:00Z');
assert.equal(isBookMarkedRead(states, catalog[2]), true);
let c = compareAuthor(owned, catalog, 'Ursula K. Le Guin', 'fr', states);
assert.equal(c.catalog.length, 3);
assert.equal(c.ownedCount, 1);
assert.equal(c.readCount, 1);
assert.equal(c.missingCount, 1);
assert.equal(c.missing[0].title, 'Les Dépossédés');
assert.equal(filterComparison(c, 'read')[0].title, 'Lavinia');
assert.equal(filterComparison(c, 'missing')[0].title, 'Les Dépossédés');
assert.equal(filterComparison(c, 'all').length, 3);
assert.equal(compareAuthor(owned, catalog, 'Ken Follet', 'fr', {}).catalog.some(x => x.title === 'Faux positif'), false);

const freeComparison = compareCatalog(owned, catalog, { mode:'free', query:'Prix du Quai des Orfèvres', language:'fr' }, {});
assert.equal(freeComparison.catalog.length, 5); // sans guillemets : on conserve le classement Kobo, hors filtre langue
const exactCatalog = [
  { title:'Le Prix du Quai des Orfèvres', subtitle:'Palmarès', authors:['A'], language:'fr', isbn:'q1' },
  { title:'Prix littéraire au Quai', subtitle:'Des Orfèvres', authors:['B'], language:'fr', isbn:'q2' },
  { title:'Enquête', description:'Lauréat du Prix du Quai des Orfèvres 2024', authors:['C'], language:'fr', isbn:'q3' }
];
assert.deepEqual(parseFreeSearch('prix "quai des orfèvres"'), { phrases:['quai des orfevres'], terms:['prix'], hasExact:true });
assert.equal(freeSearchMatches('"quai des orfèvres"', exactCatalog[0]), true);
assert.equal(freeSearchMatches('"quai des orfèvres"', exactCatalog[1]), false); // les mots sont séparés entre titre et sous-titre
assert.equal(freeSearchMatches('prix "quai des orfèvres"', exactCatalog[2]), true);
const exactComparison = compareCatalog([], exactCatalog, { mode:'free', query:'prix "quai des orfèvres"', language:'fr' }, {});
assert.deepEqual(exactComparison.catalog.map(x=>x.isbn), ['q1','q3']);
const seriesCatalog = [
  { title:'Tome 1', authors:['A'], language:'fr', series:'Les Enquêtes du commissaire', isbn:'s1' },
  { title:'Autre', authors:['B'], language:'fr', series:'Autre série', isbn:'s2' }
];
const seriesComparison = compareCatalog([], seriesCatalog, { mode:'series', query:'Enquêtes du commissaire', language:'fr' }, {});
assert.equal(seriesComparison.catalog.length, 1);
assert.equal(seriesComparison.catalog[0].title, 'Tome 1');

states = setBookReadState(states, catalog[2], false, '2026-03-01T00:00:00Z');
assert.equal(isBookMarkedRead(states, catalog[2]), false);
c = compareAuthor(owned, catalog, 'Ursula K. Le Guin', 'fr', states);
assert.equal(c.readCount, 0);
assert.equal(c.missingCount, 2);

assert.equal(publicationYear('2024-09-05T00:00:00Z'), '2024');
assert.equal(publicationYear('1965'), '1965');
assert.equal(publicationYear('sans date'), '');
const sorted = sortBooks([catalog[0], catalog[2], {title:'Sans date',authors:['X']}], 'publication-desc');
assert.deepEqual(sorted.map(x => x.title), ['Lavinia','La Main gauche de la nuit','Sans date']);
assert.deepEqual(sortBooks([catalog[0], catalog[2]], 'publication-asc').map(x => x.title), ['La Main gauche de la nuit','Lavinia']);

const stats = topAuthors(owned, { limit:20 });
assert.equal(stats.find(x => x.name === 'Ursula K. Le Guin')?.count, 2);
assert.equal(stats.find(x => x.name === 'Ursula K. Le Guin')?.ratedCount, 2);
assert.equal(stats.find(x => x.name === 'Ursula K. Le Guin')?.averageRating, 4.25);
assert.equal(stats.find(x => x.name === 'Ursula K. Le Guin')?.weightedScore, 1.7);
assert.equal(stats.find(x => x.name === 'Ken Follett')?.count, 1);
assert.equal(stats.find(x => x.name === 'Jane Doe')?.count, 1);
const aliasStats = topAuthors([{title:'A',authors:['Ken Follett']},{title:'B',authors:['Follett, Ken']}], {limit:20});
assert.equal(aliasStats.length, 1);
assert.equal(aliasStats[0].count, 2);
const weightedStats = topAuthors(owned, {limit:20, ranking:'weighted'});
assert.equal(weightedStats[0].name, 'Ursula K. Le Guin'); // 0.9 + 0.8 = 1.7, devant Dune à 0.96
assert.equal(weightedStats.find(x => x.name === 'Ken Follett')?.ratedCount, 0);

assert.equal(dedupe([{ title:'X', authors:['A'], isbn:'1' }, { title:'X2', authors:['A'], isbn:'1' }]).length, 1);

const remoteStates = setBookReadState({}, catalog[2], true, '2026-02-01T00:00:00Z');
const localStates = setBookReadState(remoteStates, catalog[2], false, '2026-03-01T00:00:00Z');
const merged = mergeVaults(
  { schema:2, updatedAt:'2026-01-01T00:00:00Z', purchases:[owned[0]], kobo:{accessToken:'old'}, catalogCache:{}, bookStates:remoteStates, settings:{} },
  { schema:2, updatedAt:'2026-02-01T00:00:00Z', purchases:[owned[1], {...owned[0], averageRating:null, ratingCount:null}], kobo:{accessToken:'new'}, catalogCache:{}, bookStates:localStates, settings:{} }
);
assert.equal(merged.purchases.length, 2);
assert.equal(merged.purchases.find(x=>x.isbn==='9780001')?.averageRating, 4.5);
assert.equal(merged.kobo.accessToken, 'new');
assert.equal(isBookMarkedRead(merged.bookStates, catalog[2]), false);
assert.equal(merged.schema, 4);
assert.equal('catalogCache' in merged, false); // cache public éphémère : jamais fusionné dans le coffre
const oversizedLegacy = { schema:3, updatedAt:'2026-03-01T00:00:00Z', purchases:[owned[0]], catalogCache:{ huge:{ items:[{ description:'x'.repeat(13 * 1024 * 1024) }] } }, bookStates:{}, settings:{} };
const compactedLegacy = mergeVaults(oversizedLegacy, { schema:4, updatedAt:'2026-02-01T00:00:00Z', purchases:[], bookStates:{}, settings:{} });
assert.equal('catalogCache' in compactedLegacy, false);
assert.ok(Buffer.byteLength(JSON.stringify(compactedLegacy), 'utf8') < 1024 * 1024, 'legacy catalog cache must not inflate the synchronized vault');

const csv = toCsv(owned);
assert.match(csv, /"title","authors"/);
assert.match(csv, /"publicationYear"/);
assert.match(csv, /"averageRating","ratingCount"/);
assert.match(csv, /"La Main gauche de la nuit"/);
console.log('model.test.mjs: OK');

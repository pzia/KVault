import assert from 'node:assert/strict';
import { normalizeLibraryEvents, extractCatalogBooks, extractRatingSummaries, parsePublicKoboRatingHtml, extractPublicKoboProductUrl, extractBestRatingFromPayload, extractReviewAggregate, extractKoboBookRating, extractKoboReviewSummary, collectRatingSignals } from '../src/worker.js';

const events = [{
  NewEntitlement: {
    BookEntitlement: { Accessibility:'Full', IsLocked:false, Created:'2026-01-02T00:00:00Z' },
    BookMetadata: {
      Title:'Test Book', RevisionId:'rev-1', ISBN:'1234', Language:'fr-FR',
      ContributorRoles:[{Name:'Ada Auteur', Role:'Author'}],
      Publisher:{Name:'Maison'}, ReleaseDate:'2025-11-03T00:00:00Z', AverageRating:4.4, RatingCount:321, CoverImageId:'cover-1', WebUrl:'https://www.kobo.com/fr/fr/ebook/test-book'
    }
  }
}, {
  NewEntitlement: {
    BookEntitlement: { Accessibility:'Preview' },
    BookMetadata: { Title:'Preview', RevisionId:'preview-1', Author:'Quelqu’un' }
  }
}];
const lib = normalizeLibraryEvents(events);
assert.equal(lib.length, 1);
assert.equal(lib[0].title, 'Test Book');
assert.deepEqual(lib[0].authors, ['Ada Auteur']);
assert.equal(lib[0].language, 'fr-FR');
assert.equal(lib[0].koboUrl, 'https://www.kobo.com/fr/fr/ebook/test-book');
assert.equal(lib[0].publicationDate, '2025-11-03T00:00:00Z');
assert.equal(lib[0].averageRating, 4.4);
assert.equal(lib[0].ratingCount, 321);

const unrated = normalizeLibraryEvents([{NewEntitlement:{BookEntitlement:{Accessibility:'Full'},BookMetadata:{Title:'Unrated',RevisionId:'u1',AverageRating:0,RatingCount:0}}}]);
assert.equal(unrated[0].averageRating, null);

const payload = { Products:[{ Book:{ Title:'Catalogue Book', RevisionId:'rev-2', ProductId:'prod-2', ContributorRoles:[{Name:'Ada Auteur',Role:'Author'}], Language:'fr', ReviewSummary:{AverageRating:4.75, TotalCount:88} } }] };
const cat = extractCatalogBooks(payload);
assert.equal(cat.length, 1);
assert.equal(cat[0].title, 'Catalogue Book');
assert.equal(cat[0].averageRating, 4.75);
assert.equal(cat[0].ratingCount, 88);

const summaries = extractRatingSummaries({ Items:[
  { ProductId:'prod-1', ReviewSummary:{ AverageRating:4.2, TotalCount:42 } },
  { ProductId:'prod-2', RatingSummary:{ AverageRating:3.9, RatingCount:17 } }
]}, ['prod-1','prod-2']);
assert.deepEqual(summaries['prod-1'], { averageRating:4.2, ratingCount:42 });
assert.deepEqual(summaries['prod-2'], { averageRating:3.9, ratingCount:17 });


const publicJsonLd = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"Book","name":"Ceux d'en bas","aggregateRating":{"@type":"AggregateRating","ratingValue":"4.3","ratingCount":"37"}}</script></head></html>`;
assert.deepEqual(parsePublicKoboRatingHtml(publicJsonLd), { averageRating:4.3, ratingCount:37, source:'json-ld' });
const publicVisible = `<h2>Avis et critiques de livres</h2><div>4,5 /5</div><span>1 234 notes</span>`;
assert.deepEqual(parsePublicKoboRatingHtml(publicVisible), { averageRating:4.5, ratingCount:1234, source:'visible-html' });
const publicUrl = `<link rel="canonical" href="https://www.kobo.com/fr/fr/ebook/ceux-d-en-bas-prix-du-polar-de-la-gendarmerie-2026">`;
assert.equal(extractPublicKoboProductUrl(publicUrl), 'https://www.kobo.com/fr/fr/ebook/ceux-d-en-bas-prix-du-polar-de-la-gendarmerie-2026');

console.log('kobo-normalize.test.mjs: OK');


const detailRating = extractBestRatingFromPayload({Book:{ReviewSummary:{AverageRating:4.6,RatingCount:123}}});
assert.deepEqual(detailRating,{averageRating:4.6,ratingCount:123,source:'api-summary'});
const reviewSummary = extractReviewAggregate({ReviewSummary:{AverageRating:4.25,TotalCount:8},Items:[{ReviewId:'r1',Rating:5}]});
assert.deepEqual(reviewSummary,{averageRating:4.25,ratingCount:8,source:'api-reviews-summary'});

// Structure observée sur l’API Kobo réelle : route par RevisionId, résumé indexé par ProductId.
const observedShapeBookPayload = { Rating:3.944444, TotalRating:18, Id:'55555555-5555-4555-8555-555555555555', CrossRevisionId:'44444444-4444-4444-8444-444444444444' };
assert.deepEqual(extractKoboBookRating(observedShapeBookPayload), { averageRating:3.944444, ratingCount:18, source:'api-book-rating' });
const observedShapeReviewsPayload = { ReviewSummary:{ '44444444-4444-4444-8444-444444444444':{ AvgRating:3.947368, OpinionCount:19, NumberOfReviews:0 } }, Items:[], TotalPageCount:0, CurrentPageIndex:0 };
assert.deepEqual(extractKoboReviewSummary(observedShapeReviewsPayload, '44444444-4444-4444-8444-444444444444'), { averageRating:3.947368, ratingCount:19, source:'api-reviews-summary' });
assert.deepEqual(extractReviewAggregate(observedShapeReviewsPayload, '44444444-4444-4444-8444-444444444444'), { averageRating:3.947368, ratingCount:19, source:'api-reviews-summary' });

const completeReviews = extractReviewAggregate({TotalCount:3,Items:[{ReviewId:'1',Rating:4},{ReviewId:'2',Rating:5},{ReviewId:'3',Rating:3}]});
assert.deepEqual(completeReviews,{averageRating:4,ratingCount:3,source:'api-reviews-complete'});
const partialReviews = extractReviewAggregate({TotalCount:20,Items:[{ReviewId:'1',Rating:5},{ReviewId:'2',Rating:1}]});
assert.equal(partialReviews,null);
const signals = collectRatingSignals({Foo:{AverageRating:4.2,RatingCount:42,Description:'secret-ish text'}});
assert.deepEqual(signals,[{path:'$.Foo.AverageRating',value:4.2},{path:'$.Foo.RatingCount',value:42}]);

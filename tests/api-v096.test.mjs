import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeLibrarySyncCandidates } from '../src/worker.js';

const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const schema=JSON.parse(fs.readFileSync(new URL('../interfaces/kobo-vault-acquisition.schema.json',import.meta.url),'utf8'));
const openapi=fs.readFileSync(new URL('../interfaces/kobo-vault-openapi-v2.3.3.yaml',import.meta.url),'utf8');
assert.equal(pkg.version,'0.9.8');
assert.equal(schema.properties.schema_version.const,'1.4');
assert.ok(schema.properties.acquisition.properties.candidates.items.properties.kobo.properties.source.enum.includes('library_sync'));
assert.match(openapi,/version: 2\.3\.3/);
const events=[{NewEntitlement:{BookMetadata:{CrossRevisionId:'prod',RevisionId:'rev',DownloadUrls:[
 {DrmType:'KDRM',Format:'FLEPUB',Url:'https://storedownloads.kobo.com/download?downloadToken=x',Platform:'Android'},
 {DrmType:'None',Format:'EPUB3FL_SAMPLE',Url:'https://storedownloads.kobo.com/sample?downloadToken=y',Platform:'Generic'}
]}}}];
const c=normalizeLibrarySyncCandidates(events,['prod','rev'],{ContentKeys:[{Name:'x',Value:'secret'}]},'Android');
assert.equal(c.length,1);
assert.equal(c[0].handling,'kobo_kdrm');
assert.equal(c[0].source_format,'FLEPUB');
assert.equal(c[0].kobo.source,'library_sync');
assert.equal(c[0].kobo.platform,'Android');
assert.equal(c[0].kobo.content_keys_present,true);
assert.equal(c[0].kobo.content_key_count,1);
assert.equal(c[0].headers['x-amz-request-payer'],'requester');

/*
 * Regression: Kobo can return two different short-lived downloadTokens for
 * the SAME purchase revision, Android platform and FLEPUB/KDRM route.
 *
 * LibrarySync exposes one semantic route per platform/DRM/format, not one
 * candidate per transient signed URL. The token is an opaque capability:
 * these assertions prove route *selection* stability, never byte equality.
 * All identifiers and URLs in this fixture are synthetic and nonfunctional.
 */
const syntheticBase = {
  DrmType:'KDRM', Format:'FLEPUB', Platform:'Android'
};
const duplicateEvents=[{
  NewEntitlement:{BookMetadata:{
    CrossRevisionId:'synthetic-cross-revision', RevisionId:'synthetic-revision',
    DownloadUrls:[
      { ...syntheticBase, Url:'https://storedownloads.kobo.com/download?downloadToken=synthetic-a' },
      { ...syntheticBase, Url:'https://storedownloads.kobo.com/download?downloadToken=synthetic-b' }
    ]
  }}
}];
const k3Routes=normalizeLibrarySyncCandidates(
  duplicateEvents, ['synthetic-cross-revision','synthetic-revision'],
  {},'Android',
);
assert.equal(k3Routes.length,1,'same KDRM/FLEPUB/Android route is one offer');
assert.equal(k3Routes[0].handling,'kobo_kdrm');
assert.equal(k3Routes[0].source_format,'FLEPUB');
assert.equal(k3Routes[0].kobo.platform,'Android');
assert.match(k3Routes[0].url,/downloadToken=synthetic-a$/);

// A different Platform is a distinct route and must not be collapsed.
const otherPlatform=structuredClone(duplicateEvents);
otherPlatform[0].NewEntitlement.BookMetadata.DownloadUrls[1].Platform='Generic';
const platformRoutes=normalizeLibrarySyncCandidates(
  otherPlatform,['synthetic-cross-revision','synthetic-revision'],{},'Android'
);
assert.equal(platformRoutes.length,2,'different platforms remain distinct');
assert.deepEqual(
  platformRoutes.map(x=>x.kobo.platform),['Android','Generic']
);

// A different declared format also remains a distinct delivery option.
const otherFormat=structuredClone(duplicateEvents);
Object.assign(otherFormat[0].NewEntitlement.BookMetadata.DownloadUrls[1],{
  DrmType:'None', Format:'PDF'
});
const formatRoutes=normalizeLibrarySyncCandidates(
  otherFormat,['synthetic-cross-revision','synthetic-revision'],{},'Android'
);
assert.equal(formatRoutes.length,2,'PDF vs FLEPUB must not be collapsed');
assert.deepEqual(formatRoutes.map(x=>x.source_format),['FLEPUB','PDF']);

console.log('api-v096.test.mjs: OK');

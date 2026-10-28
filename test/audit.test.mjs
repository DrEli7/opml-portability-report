import test from 'node:test';
import assert from 'node:assert/strict';
import { auditOpml, toMarkdown } from '../src/index.mjs';

const wrap = body => `<opml version="2.0"><head><title>Synthetic</title></head><body>${body}</body></opml>`;
const feed = (attrs = '') => `<outline text="Example" type="rss" xmlUrl="https://example.org/feed" ${attrs}/>`;

test('standard OPML parses entity-escaped labels with no findings', () => {
  const report = auditOpml(wrap('<outline text="Science &amp; tech">' + feed() + '</outline>'));
  assert.equal(report.summary.errors, 0);
  assert.equal(report.summary.warnings, 0);
  assert.equal(report.categories[0].path[0], 'Science & tech');
  assert.equal(report.summary.uniqueFeeds, 1);
});

test('FreshRSS extensions, non-standard source types and nested folders are surfaced', () => {
  const report = auditOpml(wrap('<outline text="Root"><outline text="Nested"><outline text="Scraper" type="HTML+XPath" xmlUrl="https://example.org/" xmlns:frss="https://freshrss.org/opml" frss:xPathItem="//SECRET"/></outline></outline>'));
  assert.deepEqual(report.issues.map(x => x.code).sort(), ['EXTENSION_ATTRIBUTE', 'NESTED_CATEGORY', 'NON_RSS_SOURCE_TYPE'].sort());
  assert.equal(report.extensionAttributes[0].name, 'frss:xPathItem');
  assert.doesNotMatch(JSON.stringify(report), /SECRET|https:\/\/example/);
});

test('duplicate URLs use URL canonicalization but preserve query strings', () => {
  const report = auditOpml(wrap(feed() + '<outline text="Again" type="rss" xmlUrl="https://EXAMPLE.org:443/feed"/>' + '<outline text="Other" type="rss" xmlUrl="https://example.org/feed?q=1"/>'));
  assert.equal(report.summary.uniqueFeeds, 2);
  assert.equal(report.summary.feedOccurrences, 3);
  assert.equal(report.issues[0].code, 'DUPLICATE_FEED_URL');
});

test('invalid/missing feed URLs and missing text are distinct integrity findings', () => {
  const report = auditOpml(wrap('<outline type="rss"/><outline text="bad" type="rss" xmlUrl="file:///tmp/x"/>'));
  assert.deepEqual(report.issues.map(x => x.code).sort(), ['MISSING_TEXT', 'NO_FEED_URL', 'INVALID_FEED_URL'].sort());
  assert.equal(report.summary.errors, 2);
});

test('round-trip compares missing feeds, paths and attributes without leaking values', () => {
  const before = wrap('<outline text="Folder">' + feed('xmlns:frss="https://freshrss.org/opml" frss:priority="hidden"') + '</outline><outline text="Gone" type="rss" xmlUrl="https://example.net/private?token=SECRET"/>');
  const report = auditOpml(before, { afterXml: wrap(feed()) });
  assert.equal(report.comparison.missingFeeds, 1);
  assert.equal(report.comparison.movedFeeds, 1);
  assert.equal(report.comparison.extensionLosses, 1);
  assert.doesNotMatch(JSON.stringify(report), /SECRET|hidden|example.net/);
});

test('duplicate URLs prevent false per-outline migration loss claims', () => {
  const report = auditOpml(wrap(feed() + feed()), { afterXml: wrap(feed()) });
  assert.equal(report.comparison.ambiguousFeeds, 1);
  assert.equal(report.comparison.extensionLosses, 0);
});

test('standard category attribute loss is included in round-trip category changes', () => {
  const report = auditOpml(wrap(feed('category="science"')), { afterXml: wrap(feed()) });
  assert.equal(report.comparison.movedFeeds, 1);
  assert.equal(report.issues.find(x => x.code === 'CATEGORY_CHANGED').severity, 'warning');
});

test('empty body is supported; invalid XML, wrong roots, DOCTYPE are rejected', () => {
  assert.equal(auditOpml(wrap('')).issues[0].code, 'EMPTY_OUTLINE');
  assert.throws(() => auditOpml('<opml><body></opml>'), /Invalid XML/);
  assert.throws(() => auditOpml('<rss/>'), /opml/);
  assert.throws(() => auditOpml('<!DOCTYPE opml [<!ENTITY x "payload">]>' + wrap('')), /DOCTYPE/);
  assert.throws(() => auditOpml('<opml><head/></opml>'), /body/);
});

test('more than 100 nesting levels are refused', () => {
  const nested = '<outline text="x">'.repeat(102) + feed() + '</outline>'.repeat(102);
  assert.throws(() => auditOpml(wrap(nested)), /nesting|nested/i);
});

test('Markdown category labels are escaped', () => {
  const report = auditOpml(wrap('<outline text="&lt;img|example&gt;">' + feed() + '</outline>'));
  assert.match(toMarkdown(report), /&lt;img&#124;example>/);
  assert.doesNotMatch(toMarkdown(report), /<img/);
});

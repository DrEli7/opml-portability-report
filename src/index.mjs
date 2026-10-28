import { XMLParser, XMLValidator } from 'fast-xml-parser';

const standard = new Set(['text', 'type', 'isComment', 'isBreakpoint', 'created', 'category', 'xmlUrl', 'htmlUrl', 'language', 'title', 'description', 'version', 'url']);
const array = x => x === undefined ? [] : Array.isArray(x) ? x : [x];

function parseOpml(xml) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml, 'utf8') > 20 * 1024 * 1024) throw new Error('OPML must be text no larger than 20 MiB.');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('DOCTYPE and custom entities are not supported.');
  const validity = XMLValidator.validate(xml, { allowBooleanAttributes: false });
  if (validity !== true) throw new Error(`Invalid XML at line ${validity.err.line ?? '?'}.`);
  const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseAttributeValue: false, parseTagValue: false, trimValues: false }).parse(xml);
  if (!parsed.opml || typeof parsed.opml !== 'object' || Array.isArray(parsed.opml)) throw new Error('Expected one unprefixed <opml> document root.');
  const root = parsed.opml;
  if (root.body === undefined || Array.isArray(root.body)) throw new Error('Expected exactly one <body>.');
  if (Object.keys(parsed).some(k => k !== 'opml' && k !== '?xml')) throw new Error('Unexpected element outside the OPML root.');
  const entries = [];
  const stack = array(root.body?.outline).map(node => ({ node, path: [], depth: 0 })).reverse();
  while (stack.length) {
    const { node, path, depth } = stack.pop();
    if (depth > 100) throw new Error('OPML nesting exceeds the supported 100 levels.');
    if (entries.length >= 100000) throw new Error('OPML exceeds the supported 100,000 outlines.');
    const attrs = Object.fromEntries(Object.entries(typeof node === 'object' && node ? node : {}).filter(([k]) => k.startsWith('@_')).map(([k, v]) => [k.slice(2), v]));
    const label = attrs.text || attrs.title || '(unnamed)';
    const children = array(node?.outline);
    let url;
    if (attrs.xmlUrl) {
      try {
        const candidate = new URL(attrs.xmlUrl);
        if (['https:', 'http:'].includes(candidate.protocol)) url = candidate.href;
      } catch { /* Report the invalid URL without disclosing its contents. */ }
    }
    const entry = { outline: entries.length + 1, attrs, path, label, children: children.length, url };
    entries.push(entry);
    for (let i = children.length - 1; i >= 0; i--) stack.push({ node: children[i], path: [...path, label], depth: depth + 1 });
  }
  return { version: root['@_version'], entries };
}

/** Audit OPML without fetching URLs or changing either document. Extension values stay private. */
export function auditOpml(xml, options = {}) {
  const source = parseOpml(xml);
  const after = options.afterXml === undefined ? undefined : parseOpml(options.afterXml);
  const issues = [];
  const add = (severity, code, entry, message, extra = {}) => issues.push({ severity, code, outline: entry?.outline ?? null, message, ...extra });
  if (!['1.0', '1.1', '2.0'].includes(source.version)) add('warning', 'UNKNOWN_VERSION', null, 'Missing or unrecognized OPML version.');
  if (!source.entries.length) add('warning', 'EMPTY_OUTLINE', null, 'The OPML body contains no outlines.');
  const feeds = new Map();
  const extensions = new Map();
  const categories = [];
  for (const entry of source.entries) {
    const { attrs, url, outline, path, children, label } = entry;
    if (!attrs.text) add('warning', 'MISSING_TEXT', entry, 'The required outline text attribute is missing or empty.');
    const extra = Object.keys(attrs).filter(key => !standard.has(key) && key !== 'xmlns' && !key.startsWith('xmlns:')).sort();
    for (const key of extra) {
      const count = extensions.get(key) ?? 0;
      extensions.set(key, count + 1);
      add('warning', 'EXTENSION_ATTRIBUTE', entry, 'An extension attribute may not survive another reader.', { attribute: key });
    }
    if (attrs.type && attrs.type.toLowerCase() !== 'rss' && (attrs.xmlUrl || !children)) {
      add('warning', 'NON_RSS_SOURCE_TYPE', entry, 'A non-RSS outline type requires target-reader support.', { type: attrs.type });
    }
    if (attrs.xmlUrl) {
      if (!url) add('error', 'INVALID_FEED_URL', entry, 'xmlUrl must be an absolute HTTP(S) URL.');
      else {
        if (feeds.has(url)) add('warning', 'DUPLICATE_FEED_URL', entry, 'The same normalized URL appears more than once.', { relatedOutline: feeds.get(url)[0].outline });
        const group = feeds.get(url) ?? []; group.push(entry); feeds.set(url, group);
        if (!attrs.type) add('warning', 'MISSING_FEED_TYPE', entry, 'A feed URL has no type attribute.');
      }
      if (children) add('warning', 'FEED_WITH_CHILDREN', entry, 'This feed is also a parent; importers may flatten or ignore its children.');
    } else if (children) {
      categories.push({ outline, path: [...path, label], children });
      if (path.length) add('warning', 'NESTED_CATEGORY', entry, 'Nested categories may be flattened by the destination reader.');
    } else {
      add(attrs.type?.toLowerCase() === 'rss' ? 'error' : 'warning', 'NO_FEED_URL', entry, 'A leaf outline has no xmlUrl; it is not a portable RSS subscription.');
    }
  }
  let comparison;
  if (after) {
    const destination = new Map();
    for (const entry of after.entries) {
      if (entry.url) { const group = destination.get(entry.url) ?? []; group.push(entry); destination.set(entry.url, group); }
    }
    let missingFeeds = 0; let movedFeeds = 0; let extensionLosses = 0; let ambiguousFeeds = 0;
    for (const [url, entries] of feeds) {
      const matches = destination.get(url) ?? [];
      if (!matches.length) { missingFeeds++; add('error', 'MISSING_AFTER_IMPORT', entries[0], 'This source feed is absent from the round-trip export.'); continue; }
      if (entries.length > 1 || matches.length > 1) {
        ambiguousFeeds++; add('warning', 'AMBIGUOUS_ROUNDTRIP', entries[0], 'Repeated URLs prevent an unambiguous category/extension comparison.'); continue;
      }
      const before = entries[0]; const current = matches[0];
      if (JSON.stringify(before.path) !== JSON.stringify(current.path) || before.attrs.category !== current.attrs.category) { movedFeeds++; add('warning', 'CATEGORY_CHANGED', before, 'The feed category path or category attribute changed in the round-trip export.'); }
      const important = Object.keys(before.attrs).filter(k => k === 'type' || (!standard.has(k) && k !== 'xmlns' && !k.startsWith('xmlns:')));
      for (const attribute of important) {
        if (before.attrs[attribute] !== current.attrs[attribute]) {
          extensionLosses++; add('warning', 'ATTRIBUTE_CHANGED_OR_LOST', before, 'A source type or extension attribute changed or disappeared.', { attribute });
        }
      }
    }
    comparison = { afterOutlines: after.entries.length, afterUniqueFeeds: destination.size, missingFeeds, movedFeeds, extensionLosses, ambiguousFeeds, addedFeeds: [...destination.keys()].filter(k => !feeds.has(k)).length };
  }
  return {
    schemaVersion: 1, tool: 'opml-portability-report',
    summary: { outlines: source.entries.length, uniqueFeeds: feeds.size, feedOccurrences: [...feeds.values()].reduce((n, rows) => n + rows.length, 0), categories: categories.length, errors: issues.filter(x => x.severity === 'error').length, warnings: issues.filter(x => x.severity === 'warning').length },
    categories, extensionAttributes: [...extensions].map(([name, occurrences]) => ({ name, occurrences })),
    ...(comparison ? { comparison } : {}), issues,
  };
}

const cell = value => String(value ?? '—').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\|/g, '&#124;').replace(/[\r\n]/g, ' ');
export function toMarkdown(report) {
  const s = report.summary;
  return [
    '# OPML portability report', '',
    `Outlines: **${s.outlines}** · Unique feeds: **${s.uniqueFeeds}** · Categories: **${s.categories}**`,
    `Errors: **${s.errors}** · Warnings: **${s.warnings}**`, '',
    'Feed URLs and extension values are omitted. No URLs were fetched.', '',
    ...(report.comparison ? ['## Round-trip comparison', '', ...Object.entries(report.comparison).map(([key, value]) => `- ${key}: ${value}`), ''] : []),
    '## Categories', '', ...report.categories.map(c => `- Outline ${c.outline}: ${cell(c.path.join(' / '))}`), '',
    '## Findings', '', '| Outline | Severity | Code | Detail |', '| ---: | --- | --- | --- |',
    ...report.issues.map(i => `| ${cell(i.outline)} | ${i.severity} | ${i.code} | ${cell(i.message)}${i.attribute ? ` Attribute: ${cell(i.attribute)}.` : ''}${i.type ? ` Type: ${cell(i.type)}.` : ''}${i.relatedOutline ? ` Related outline: ${i.relatedOutline}.` : ''} |`), '',
    report.issues.length ? '' : 'No findings within this tool’s supported checks.', '',
    'Warnings indicate possible portability loss, not a proven incompatibility with a specific reader.', '',
  ].join('\n');
}

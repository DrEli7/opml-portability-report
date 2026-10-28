import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

test('CLI round-trip JSON reports missing feeds and leaves both files unchanged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'opml-report-test-'));
  try {
    const before = join(dir, 'before.opml'); const after = join(dir, 'after.opml');
    const input = '<opml version="2.0"><body><outline text="Example" type="rss" xmlUrl="https://example.org/rss"/></body></opml>';
    const output = '<opml version="2.0"><body/></opml>';
    writeFileSync(before, input); writeFileSync(after, output);
    const result = run([before, '--after', after, '--format', 'json']);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(JSON.parse(result.stdout).comparison.missingFeeds, 1);
    assert.equal(readFileSync(before, 'utf8'), input); assert.equal(readFileSync(after, 'utf8'), output);
    assert.equal(run([before, '--after', after, '--fail-on', 'never']).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI warning threshold, usage failures, help and invalid UTF-8 behave correctly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'opml-report-test-'));
  try {
    const path = join(dir, 'input.opml'); writeFileSync(path, '<opml version="2.0"><body/></opml>');
    assert.equal(run([path]).status, 0);
    assert.equal(run([path, '--fail-on', 'warning']).status, 1);
    assert.equal(run([path, '--format', 'xml']).status, 2);
    assert.equal(run([path, '--format', 'json', '--format', 'markdown']).status, 2);
    assert.equal(run(['--unknown']).status, 2);
    assert.equal(run(['--help']).status, 0);
    writeFileSync(path, Buffer.from([0xff]));
    assert.equal(run([path]).status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

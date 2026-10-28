#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { auditOpml, toMarkdown } from './index.mjs';

const help = `Usage: opml-portability-report INPUT.opml [options]

  --after FILE                 Compare the destination reader's OPML export
  --format markdown|json       Default: markdown
  --fail-on error|warning|never Default: error
  --help                       Show help

UTF-8 inputs up to 20 MiB. No network access, no input edits.
Exit 0: threshold not met; 1: findings; 2: invalid arguments or unreadable input.
`;

async function readText(path) {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > 20 * 1024 * 1024) throw new Error('Input must be a regular file no larger than 20 MiB.');
  return new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path));
}

try {
  const { values, positionals, tokens } = parseArgs({ options: {
    after: { type: 'string' }, format: { type: 'string' }, 'fail-on': { type: 'string' }, help: { type: 'boolean' },
  }, allowPositionals: true, strict: true, tokens: true });
  const names = tokens.filter(t => t.kind === 'option').map(t => t.name);
  if (new Set(names).size !== names.length) throw new Error('Duplicate options are not allowed.');
  if (values.help) { process.stdout.write(help); }
  else {
    if (positionals.length !== 1) throw new Error('Provide exactly one input file. See --help.');
    const format = values.format ?? 'markdown';
    const failOn = values['fail-on'] ?? 'error';
    if (!['markdown', 'json'].includes(format)) throw new Error('--format must be markdown or json.');
    if (!['error', 'warning', 'never'].includes(failOn)) throw new Error('--fail-on must be error, warning, or never.');
    const report = auditOpml(await readText(positionals[0]), { afterXml: values.after === undefined ? undefined : await readText(values.after) });
    process.stdout.write(format === 'json' ? JSON.stringify(report, null, 2) + '\n' : toMarkdown(report));
    if (failOn !== 'never' && (report.summary.errors || (failOn === 'warning' && report.summary.warnings))) process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(`opml-portability-report: ${error.message}\n`);
  process.exitCode = 2;
}

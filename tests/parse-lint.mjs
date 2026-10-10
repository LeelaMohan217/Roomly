/** Turns `expo lint` output into one line per finding: file, rule, message. */
import { readFileSync } from 'node:fs';

const lines = readFileSync(process.argv[2], 'utf8').split('\n');
const findings = [];
let file = '';

for (const raw of lines) {
  const line = raw.replace(/\r$/, '');

  // A bare path line marks the start of a file's findings.
  if (/\.tsx?$/.test(line.trim()) && /[\\/]/.test(line)) {
    const idx = line.lastIndexOf('roomly');
    file = idx >= 0 ? line.slice(idx + 'roomly'.length + 1) : line.trim();
    continue;
  }

  const m = line.match(/^\s+(\d+):(\d+)\s+(error|warning)\s+(.+?)\s{2,}([a-z@][a-z@/-]*)\s*$/i);
  if (m) {
    findings.push({
      severity: m[3],
      file: file.replace(/\\/g, '/'),
      line: m[1],
      rule: m[5],
      message: m[4].replace(/\s+/g, ' ').slice(0, 90),
    });
  }
}

const errors = findings.filter((f) => f.severity === 'error');
const warnings = findings.filter((f) => f.severity === 'warning');

console.log('## lint: ' + errors.length + ' errors, ' + warnings.length + ' warnings\n');
for (const f of [...errors, ...warnings]) {
  console.log(
    (f.severity === 'error' ? 'ERROR ' : 'warn  ') +
      f.file + ':' + f.line + '\n        ' + f.rule + ' -- ' + f.message
  );
}

/** Minimal assertion harness. No runner dependency: these run under
 *  `node --experimental-strip-types` so the suite needs no install. */

export type Result = { suite: string; name: string; ok: boolean; detail: string };

export const results: Result[] = [];
let current = 'general';

export function suite(name: string): void {
  current = name;
}

export function check(name: string, ok: boolean, detail = ''): void {
  results.push({ suite: current, name, ok, detail });
}

export function eq(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, a === e ? '' : `got ${a}, expected ${e}`);
}

export function throws(name: string, fn: () => unknown): void {
  try {
    fn();
    check(name, false, 'expected a throw, got none');
  } catch {
    check(name, true);
  }
}

export function noThrow(name: string, fn: () => unknown): void {
  try {
    fn();
    check(name, true);
  } catch (e) {
    check(name, false, `threw: ${(e as Error).message}`);
  }
}

export function report(): number {
  const failed = results.filter((r) => !r.ok);
  let lastSuite = '';
  for (const r of results) {
    if (r.suite !== lastSuite) {
      console.log(`\n## ${r.suite}`);
      lastSuite = r.suite;
    }
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  -- ' + r.detail : ''}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log('\nFAILING:');
    for (const f of failed) console.log(`  [${f.suite}] ${f.name} -- ${f.detail}`);
  }
  return failed.length;
}

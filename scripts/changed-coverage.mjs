import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// These entrypoints only wire processes/DOM; Compose and Chromium exercise them.
// The gateway entrypoint starts only under the opt-in `gateway` Compose profile
// (M2 activation), so no suite runs it yet.
const excluded = new Set([
  'apps/admin/src/main.tsx',
  'apps/api/src/main.ts',
  'apps/gateway/src/main.ts',
  'apps/worker/src/main.ts',
]);
export function changedCoverage(diff, lcov) {
  const records = new Map();
  let record;
  for (const line of lcov.split('\n')) {
    if (line.startsWith('SF:')) {
      record = { lines: new Map(), branches: [] };
      records.set(line.slice(3), record);
    }
    if (line.startsWith('DA:') && record) {
      const [number, hits] = line.slice(3).split(',').map(Number);
      record.lines.set(number, hits);
    }
    if (line.startsWith('BRDA:') && record) {
      const [number, , , hits] = line.slice(5).split(',');
      record.branches.push([Number(number), Number(hits) || 0]);
    }
  }
  const changed = new Map();
  let file;
  let number = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      file = line.slice(6);
      changed.set(file, new Set());
    } else if (line.startsWith('@@'))
      number = Number(line.match(/\+(\d+)/)?.[1]);
    else if (line.startsWith('+')) {
      changed.get(file)?.add(number++);
    } else if (line.startsWith(' ')) number++;
  }
  const totals = { lines: 0, coveredLines: 0, branches: 0, coveredBranches: 0 };
  for (const [path, lines] of changed) {
    if (
      !/^(apps|packages)\/[^/]+\/src\/.*\.tsx?$/.test(path) ||
      excluded.has(path) ||
      !lines.size
    )
      continue;
    const data = records.get(path);
    if (!data) throw new Error(`Missing coverage for changed source: ${path}`);
    for (const [number, hits] of data.lines)
      if (lines.has(number)) {
        totals.lines++;
        if (hits > 0) totals.coveredLines++;
      }
    for (const [number, hits] of data.branches)
      if (lines.has(number)) {
        totals.branches++;
        if (hits > 0) totals.coveredBranches++;
      }
  }
  if (totals.lines && totals.coveredLines / totals.lines < 0.85)
    throw new Error('Changed lines below 85%');
  if (totals.branches && totals.coveredBranches / totals.branches < 0.8)
    throw new Error('Changed branches below 80%');
  return totals;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const base = process.env.BASE_REVISION;
  // First push of a branch: compare with its first parent, not an all-zero SHA.
  const revision = base && !/^0+$/.test(base) ? base : 'HEAD^';
  const diff = execFileSync('git', ['diff', '--unified=0', revision, 'HEAD'], {
    encoding: 'utf8',
  });
  console.log(
    changedCoverage(diff, readFileSync('coverage/lcov.info', 'utf8')),
  );
}

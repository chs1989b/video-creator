// Re-price finished FLUX/TTS stages recorded with the pre-10/14 table.
//   node scripts/reprice-records.mjs           # show what would change
//   node scripts/reprice-records.mjs --apply   # back up data/db.json, then write
// Stop the worker first: it keeps the database in memory and would write its
// own copy back over these changes.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createDb, listJobs, updateJob } from '../src/pipeline/db.js';
import { repriceFinishingStages, jobTotals } from '../src/pipeline/costs.js';

const apply = process.argv.includes('--apply');
const dbPath = path.join(process.cwd(), 'data', 'db.json');
const db = createDb(dbPath);

const plan = [];
for (const job of await listJobs(db)) {
  const { stages, changes } = repriceFinishingStages(job);
  if (changes.length === 0) continue;
  const before = jobTotals(job).credits;
  const after = jobTotals({ ...job, stages }).credits;
  plan.push({ job, stages });
  const detail = changes.map((c) => `${c.stage} ${c.from}→${c.to}`).join(', ');
  console.log(`${job.id.slice(0, 8)} ${job.mock ? 'test' : 'REAL'}  ${detail}  (total ${before}→${after})`);
}

if (plan.length === 0) {
  console.log('nothing to re-price');
} else if (!apply) {
  console.log(`${plan.length} job(s) would change — run again with --apply to write`);
} else {
  const backup = `${dbPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  await fs.copyFile(dbPath, backup);
  for (const { job, stages } of plan) await updateJob(db, job.id, { stages });
  console.log(`re-priced ${plan.length} job(s); backup at ${path.basename(backup)}`);
}

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// mongodb-memory-server puts its data dirs under os.tmpdir(). On the dev
// VM /tmp is a small (512 MB) tmpfs that orphaned dirs from killed runs
// once filled to 97% — so test scratch lives in a repo-local, gitignored
// directory instead and a plain `npm test` never needs manual cleanup.
// os.tmpdir() honors TMPDIR, and vitest workers inherit this env.
const testTmpDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.test-tmp');
mkdirSync(testTmpDir, { recursive: true });
process.env.TMPDIR = testTmpDir;

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // One shared MongoMemoryReplSet for all integration suites
    // (tests/global-setup.ts); suites isolate by database name.
    globalSetup: ['./tests/global-setup.ts'],
  },
});

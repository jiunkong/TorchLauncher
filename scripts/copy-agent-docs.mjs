// Copies local-only coordination documents from the coordinator checkout into a worker worktree.
// Usage: node scripts/copy-agent-docs.mjs <worktree> <docs-relative-path>...
// Example: node scripts/copy-agent-docs.mjs .agents/worktrees/x studio-files-task.md handoffs/STUDIO-FILES-01.md
import { execFileSync } from 'node:child_process';
import { cp, mkdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

const [target, ...names] = process.argv.slice(2);
if (!target || names.length === 0) {
  console.error('Usage: node scripts/copy-agent-docs.mjs <worktree> <docs-relative-path>...');
  process.exit(2);
}

// The first entry of `git worktree list` is the coordinator (main) checkout.
const list = execFileSync('git', ['worktree', 'list', '--porcelain'], { encoding: 'utf8' });
const coordinator = list.split('\n')[0].replace(/^worktree /, '');
const sourceRoot = resolve(coordinator, 'docs');
const targetRoot = resolve(target, 'docs');
const inside = (root, path) => {
  const rel = relative(root, path);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
};

await stat(resolve(target, '.git')).catch(() => {
  throw new Error(`${target} is not a git worktree`);
});
for (const name of names) {
  const from = resolve(sourceRoot, name);
  const to = resolve(targetRoot, name);
  if (!inside(sourceRoot, from) || !inside(targetRoot, to)) throw new Error(`Refusing ${name}`);
  await stat(from).catch(() => {
    throw new Error(`Missing in coordinator docs: ${name}`);
  });
  await mkdir(dirname(to), { recursive: true });
  await cp(from, to, { recursive: true });
  console.log(`copied docs/${name}`);
}

// Closes spaces whose checkout was deleted. `gh pr merge --delete-branch`, a
// plain `git worktree remove` or `rm -rf` take a worktree away without telling
// Herdr, so its space lingers with terminals in a folder that no longer exists.
//
// A local background space is dead when its original folder and every live
// terminal's folder are gone and no agent is working.
// A space must be found dead on two sweeps in a row, so a folder that is only
// briefly missing keeps its space.

// Prints 1 for each folder that exists and 0 for each that doesn't, in order.
const CHECK = 'for d; do if [ -d "$d" ]; then echo 1; else echo 0; fi; done';

export function createDeadSpaces({ spaces, terminals, exec, run, notify, home }) {
  // Space id -> the folders it was found dead with on the last sweep.
  let suspects = new Map();
  let sweeping = false;

  // The space's folders when it qualifies, or null.
  function candidateFolders(space, byspace) {
    if (space.machine || space.active) return null;
    const list = byspace.get(space.id) ?? [];
    if (list.length === 0) return null;
    // A space with no folder of its own starts its terminals at home.
    const folders = new Set([space.folder || home()]);
    for (const t of list) {
      if ((t.status ?? t.report?.state) === 'working') return null;
      const cwd = t.foreground?.cwd ?? t.cwd;
      if (!cwd) return null;
      folders.add(cwd);
    }
    return [...folders].every((f) => f.startsWith('/')) ? [...folders] : null;
  }

  // Each candidate space with its folders, read from the live model now.
  function candidates() {
    const byspace = new Map();
    for (const t of terminals()) {
      const id = t.labels?.['herdr.space'];
      if (!id || t.state !== 'live') continue;
      if (!byspace.has(id)) byspace.set(id, []);
      byspace.get(id).push(t);
    }
    const found = new Map();
    for (const space of spaces()) {
      const folders = candidateFolders(space, byspace);
      if (folders) found.set(space.id, { space, folders, key: folders.slice().sort().join('\n') });
    }
    return found;
  }

  async function sweep() {
    if (sweeping) return;
    sweeping = true;
    try {
      const before = candidates();
      if (before.size === 0) {
        suspects = new Map();
        return;
      }

      const paths = [...new Set([...before.values()].flatMap((c) => c.folders))];
      let result;
      try {
        result = await exec('sh', ['-c', CHECK, 'sh', ...paths]);
      } catch {
        return;
      }
      const answers = result.stdout.trim().split('\n');
      if (result.code !== 0 || answers.length !== paths.length) return;
      const exists = new Map(paths.map((p, i) => [p, answers[i] === '1']));

      // Recheck in case an agent woke, a terminal moved, or the space was shown
      // while the folder probe ran.
      const after = candidates();
      const next = new Map();
      for (const { space, folders, key } of before.values()) {
        if (after.get(space.id)?.key !== key) continue;
        if (folders.some((f) => exists.get(f))) continue;
        if (suspects.get(space.id) !== key) {
          next.set(space.id, key);
          continue;
        }
        run('space.close', { id: space.id, confirmed: true });
        notify({
          title: `Closed space ${space.name}`,
          body: `Its folder no longer exists: ${folders[0]}`,
          level: 'info',
        });
      }
      suspects = next;
    } finally {
      sweeping = false;
    }
  }

  return { sweep };
}

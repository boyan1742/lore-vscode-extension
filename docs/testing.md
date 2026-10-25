# Testing

## Automated

```
npm run test:unit      # compile-tests (tsc for extension + webview) then mocha (tdd UI)
npm run lint
npm run compile        # dev bundles
npm run package        # production bundles
```

`test:unit` runs `src/test/parsers.test.ts` (16 tests) and `src/test/graph.test.ts` (4 tests). They need neither VS Code nor a Lore install.

### Fixtures

`src/test/fixtures.ts` holds output captured from `lore 0.10.1+1476`, verbatim including quirks (trailing spaces in `A b.txt `, `M  a.txt (M)!`, paths with spaces). Covered shapes: status (clean, dirty, merging, branch-not-pushed), branch list (with remote/archived, offline), branch info, history (merge commit, explicit parent), branch diff (clean, conflicting), merge output (clean, conflicted), repository info.

**When Lore changes its wording:** run the real command, replace the fixture with the new output, and fix the parser until the tests pass. Do not loosen a test to make it pass without looking at the new output.

### What the unit tests assert

- Status sections, conflict marker `!`, ignoring `(X)` suffix, pending merge, sync classification (`in sync`, `ahead`, `diverged`, `Remote branch does not exist`).
- Branch list sections, current marker, archived, offline warning.
- History blocks: multi-line messages, `Merge`, explicit `Parent`.
- `branch diff`: changes and conflicts, paths with spaces.
- Merge result discrimination (`Committed merged repository state` vs `Files in conflict:`).
- Health URL uses the HTTP port, not the `lore://` port; override URL wins.
- Graph: nodes keyed by signature (two "revision 2" stay distinct), children before parents, merged branch gets its own lane, windowing cuts edges and sets `truncated`.

## End-to-end smoke test (manual procedure)

The service layer imports nothing from `vscode`, so it can be driven from Node against a real server. The script used during development is not committed; recreate it like this.

1. Start a server: `loreserver` (demo defaults: auth off, ports 41337/41339). Confirm `curl http://127.0.0.1:41339/health_check` returns 200.
2. `npm run compile-tests` (emits `out/`).
3. In a Node script, `require('out/lore/service.js')`, create `new LoreService(emptyDir, () => ({executable:'lore', identity:'smoke', healthPort:41339, healthUrl:'', graphMaxRevisions:50}), prStoreMap, log)`.
4. Exercise and assert:
   - `init(lore://127.0.0.1:41337/<unique>)`, write files, `refresh({scan:true})` sees untracked files, `stageAll`, `unstage`, `commit`, `push`, `checkHealth` is `ok`, status is `inSync`.
   - `createBranch(feature, true)`, commit, `compare(feature, main)`, `createPullRequest`: merged, source archived, working tree on `main`, record stored.
   - Conflicting branches: `createPullRequest` refuses and changes nothing; `merge` returns `conflicted`; `resolve('theirs')`; `commit`; second conflict then `abortMerge` restores the file.
   - `loadGraph` returns merge rows, including revisions of an archived branch.
5. Stop the server and delete the temp repositories.

Each repository name on the server must be unique per run.

## Manual UI test plan

Not yet executed (no Extension Development Host session was run when the extension was written). Press F5, open a folder, and walk through:

| Area | Check |
| --- | --- |
| Activation | Activity bar icon appears in a folder with `.lore`; Initialize form appears otherwise |
| Webview boot | No console errors (Developer: Open Webview Developer Tools); the webview is not blank in the dev build |
| CLI missing | Set `lore.path` to a bad value: error banner with Retry; fix it and retry |
| Changes | Stage/unstage/discard (confirm dialogs), diff for modified, added, deleted files, commit with Ctrl+Enter, failed commit keeps text |
| Identity | With no identity configured, a commit failure offers Set identity |
| Branches | Create with and without switch, invalid names rejected, switch blocked with dirty tree, archive |
| History | Merge commits drawn hollow, labels on tips, click selects, window notice with a small `maxRevisions` |
| Merge | Clean merge auto-commits; conflicting merge jumps to Changes; Take mine/theirs/Mark resolved; Abort restores files; commit disabled until resolved |
| Pull request | Clean: merges, pushes, archives, record appears. Conflicting: button disabled and files listed. Dirty tree: warning. Push failure (diverge the server first): source stays unarchived |
| Push/Pull | Disabled with no remote; diverged push offers Pull; pull with conflicts navigates to Changes |
| Health | Stop `loreserver`: dot turns red within the interval, Server tab shows the error; restart: recovers |
| Layout | Narrow sidebar and the wide panel; dark, light and high-contrast themes |
| Auto refresh | Edit a file outside VS Code: Changes updates; no refresh loop in the command log |
| Accessibility | Keyboard-only: tabs, buttons and forms reachable; focus outlines visible |

## Known gaps

- No automated UI tests, and no extension-host integration tests beyond the generated sample in `src/test/extension.test.ts`.
- Unverified Lore behavior: switching to a server-only branch; `sync` leaving conflicts; the exact failure text when no identity is configured; Windows paths with unusual characters.

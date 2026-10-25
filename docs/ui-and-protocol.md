# UI and protocol

## Surfaces

| Surface | Id | Layout flag |
| --- | --- | --- |
| Activity bar container **Lore** with webview view **Actions** | `lore.actions` | `data-layout="sidebar"` |
| Editor-area panel, one at a time, `retainContextWhenHidden` | `lore.panel` | `data-layout="panel"` (max width 980 px, centered) |
| Status bar item (left, priority 50) | | |

Both webviews render the same bundle (`dist/webview.js`) and receive the same snapshots. Activation events: `workspaceContains:.lore`, `onView:lore.actions`, `onCommand:lore.openPanel`.

## Screens

Header (always visible): branch pill with sync state, **Pull**, **Push**, refresh, health dot. Below it a progress strip shows the running operation label, then a scrollable tab bar:

| Tab | Component | Content |
| --- | --- | --- |
| Changes (badge = change count, red = conflict count) | `Changes.tsx` | Merge banner, commit box, Merge conflicts, Staged changes, Changes |
| History | `Graph.tsx` | Full graph |
| Branches | `Branches.tsx` | New branch form, Branches, On the server only, Archived |
| Merge | `Merge.tsx`, `Compare.tsx` | Compact graph, source select, message, comparison, Merge button |
| Pull request | `PullRequest.tsx`, `Compare.tsx` | Form, comparison, Create & merge, Merged pull requests |
| Server | `Server.tsx` | Health, repository details, command log link |

Other full-view states: no folder, `lore` not found (Retry), not a repository (Initialize form).

Styling uses only VS Code theme variables (`--vscode-*`), so it follows the active theme. Eight branch colors (`--lore-c0..c7`) are assigned by hashing the branch ID. Motion respects `prefers-reduced-motion`. Tabs use `role="tab"`/`tabpanel`; the progress strip and toasts are `aria-live`. Icon-only buttons carry `title` and `aria-label`.

UI state persisted across reloads via `getState/setState`: the selected tab only. The commit draft and merge source live in memory.

## Message protocol

Defined in `src/shared/protocol.ts`; type-only so both bundles share it. The host sends a **full `Snapshot`** on every state change; there are no partial updates.

### Webview → host (`Request`)

| `type` | Fields | Host action |
| --- | --- | --- |
| `ready` | | Send snapshot (and any pending navigation), then refresh without scan, graph on |
| `refresh` | `scan?` | Scanning refresh with graph, plus a health check |
| `loadGraph` | | Rebuild graph |
| `init` | `remoteUrl?`, `name?` | Create repository |
| `stage` / `unstage` | `paths` | Stage / unstage |
| `stageAll` | | Stage all unstaged and untracked |
| `discard` | `paths`, `untracked?` | Confirm, then reset (with `--purge` for untracked) |
| `commit` | `message` | Commit; replies `committed` on success |
| `openFile` | `path` | Show the working file |
| `openDiff` | `path`, `state`, `staged` | Working tree vs head diff |
| `openBranchDiff` | `path`, `state`, `source`, `target` | Diff of two branch tips |
| `resolve` | `mode: mine \| theirs \| resolved`, `paths` | Conflict resolution |
| `abortMerge` | | Confirm, then abort |
| `createBranch` | `name`, `switchTo` | Create (and switch) |
| `switchBranch` / `archiveBranch` | `name` | Switch / confirm and archive |
| `push` / `pull` | | Push / sync |
| `compare` | `source`, `target`, `requestId` | Branch comparison; replies `compare` |
| `merge` | `source`, `message?` | Merge into current branch |
| `createPullRequest` | `source`, `target`, `title`, `description` | Pull request emulation |
| `healthCheck` | | Check now |
| `showOutput` | | Reveal the Lore output channel |

### Host → webview (`Message`)

| `type` | Fields |
| --- | --- |
| `state` | `snapshot` |
| `compare` | `requestId`, `result?` or `error?` (stale responses are ignored by `requestId`) |
| `committed` | none; the webview clears its draft |
| `toast` | `level: info \| warn \| error`, `text` (auto-dismiss 4.5 s, errors 9 s, max 4 shown) |
| `navigate` | `tab`, `source?`; remembered until a webview is ready, so it works right after opening the panel |

### Snapshot

```
hasWorkspace, isRepo, root?, busy?          busy = label of the running operation
status?: RepoStatus                        branch, revision, signature, remote revision, sync state,
                                           pendingMerge?, staged[], unstaged[], untracked[], conflicts[]
branches: BranchEntry[]                    name, current, local, remote, archived, id?, latest?
repoInfo?, health: HealthInfo, graph?: GraphData
pullRequests: PullRequestRecord[]
cliError?, lastError?, identityConfigured
```

`SyncState`: `unknown | inSync | ahead | behind | diverged | noRemoteBranch | noRemote`.
`HealthState`: `unknown | checking | ok | down | noRemote`.

Errors: a failing request is toasted in the requesting webview only. Operation errors are also stored as `lastError` and rendered as a banner until the next operation.

## Graph layout

`buildGraph` (pure, tested) takes per-branch histories and returns `GraphData { rows, edges, columns, truncated }`.

1. **Nodes** keyed by signature. Parents: explicit `Parent` lines, else the next entry in the same list; plus the `Merge` signature.
2. **Order**: Kahn-style, children before parents; among ready nodes the newest date first, ties by revision number.
3. **Window**: first `maxRevisions` nodes; `truncated` is set when more exist.
4. **Lanes**: walk rows top to bottom keeping `lanes[]` of the signature each lane is waiting for. A node takes the first lane waiting for it (else a free lane), and closes other lanes waiting for it. Its first parent continues in the node's lane unless another lane already waits for that parent; further parents take a waiting or free lane.
5. **Edges**: `{fromRow, toRow, fromCol, lane, toCol, color}`. `toRow === rows.length` marks a parent outside the window (drawn to the bottom edge).
6. **Rendering** (`Graph.tsx`): row height 30 px, column width 16 px. Each edge is one SVG path: curve out of the child to its lane, straight down the lane, curve into the parent column. Adjacent rows use a single S-curve.

Row details are shown in a box under the list, not inline, so every row keeps a fixed height and the SVG stays aligned.

## Settings

| Setting | Type | Default | Meaning |
| --- | --- | --- | --- |
| `lore.path` | string | `lore` | Executable |
| `lore.identity` | string | empty | `--identity` value; empty defers to `.lore/config.toml` |
| `lore.autoRefresh` | boolean | `true` | Refresh on workspace file changes |
| `lore.healthCheck.port` | number | `41339` | HTTP port |
| `lore.healthCheck.url` | string | empty | Full URL override |
| `lore.healthCheck.intervalSeconds` | number | `30` | `0` disables polling |
| `lore.graph.maxRevisions` | number | `100` (10–1000) | Graph window |

Changing any `lore.*` setting reschedules health checks and refreshes (no scan).

## Commands

| Command id | Title | Notes |
| --- | --- | --- |
| `lore.openPanel` | Lore: Open Lore Panel | View title button |
| `lore.refresh` | Lore: Refresh | View title button |
| `lore.initRepository` | Lore: Initialize Repository | Input box for remote URL |
| `lore.createBranch` | Lore: Create Branch | Creates and switches |
| `lore.switchBranch` | Lore: Switch Branch | Quick pick |
| `lore.push` | Lore: Push | |
| `lore.pull` | Lore: Pull (Sync) | |
| `lore.createPullRequest` | Lore: Create Pull Request | Opens the panel on the Pull request tab |
| `lore.healthCheck` | Lore: Check Server Health | Shows a notification with the result |
| `lore.showOutput` | Lore: Show Command Log | |

Commands that need a repository show "This folder is not a Lore repository." otherwise.

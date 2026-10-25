# Feature specifications

Each entry lists what the user can do, the exact `lore` commands run, preconditions the extension enforces, and what happens on each outcome. All commands are run through the serialized queue described in [architecture.md](architecture.md), and every mutating operation is followed by a scanning refresh.

## 0. Repository detection and initialization

- A workspace folder is a Lore repository when it contains `.lore`. The first such folder is used; otherwise the first folder.
- Not a repository: the view shows an **Initialize repository** form with an optional remote URL (`Lore: Initialize Repository` does the same through an input box).
  - With URL: `lore repository create <url>`.
  - Without: `lore --offline repository create <folder name>`.
- No folder open: "Open a folder to use Lore."
- `lore` not found: full-screen error with the message and **Retry**.

## 1. Changes: staging and diff

| Action | Command | Notes |
| --- | --- | --- |
| Stage a file | `stage <path>` | Row `+` button |
| Stage all | `stage <all unstaged and untracked paths>` | Section `+` button |
| Unstage | `unstage <paths>` | Row or section `−` button |
| Discard (modified/deleted) | `reset <path>` | Modal confirmation first |
| Discard (untracked) | `reset --purge <path>` | Modal confirmation; deletes only the named file |
| Open file | opens the working file | Hidden for deleted files |
| Diff | VS Code diff editor, left = `lore:` at the current head signature, right = working file | Added file: left is empty. Deleted file: right is empty. Title `<path> (Lore: revision ↔ working tree)` |

Categories come from `status --scan`: **Staged**, **Changes** (modified/deleted, unstaged), untracked files shown under Changes, and **Merge conflicts**. Letter badges: A added, M modified, D deleted, R renamed, C conflict.

## 2. Commit

- Command: `commit <message>`.
- Enabled when: at least one staged file, no unresolved conflicts, non-empty message, and nothing else running.
- `Ctrl+Enter` in the message box commits.
- The message is cleared **only** when the host confirms success (`committed` message). A failed commit keeps the text.
- On success the graph is reloaded and a toast says "Committed."
- When a merge is pending, the button reads **Commit merge** and the same command creates the merge revision.
- Error `No commit identity configured…` offers **Set identity**, which stores `lore.identity` in user settings.

## 3. Create and switch branches

- **Create**: Branches tab form, or `Lore: Create Branch`. Runs `branch create <name>` and, with "Switch to it" checked (default), `branch switch <name>`. The name is rejected in the UI if empty, contains whitespace or `~ ^ : ? * [ \`, or matches an existing local or archived branch.
- **Switch**: row **Switch** button, or `Lore: Switch Branch` quick pick. Runs `branch switch <name>`. Refused with a message when changes are staged or modified, or a merge is pending ("Commit or discard your changes before you switch branches").
- **Archive**: row button with modal confirmation; `branch archive <name>`. The current branch cannot be archived.
- Branches that exist only on the server are listed with a `remote` tag and no actions. Local branches that were never pushed carry a `local` tag when a remote exists.

## 4. History

- Graph of every live local branch plus recovered merged branches (see [architecture.md](architecture.md#graph-pipeline)).
- Each row: lane graphics, branch labels at that revision, first message line, author (`Merger` for merge commits, else `Creator`), relative time. Clicking a row shows a detail box: revision number and branch, full signature, parents, author, date, full message.
- Merge commits are drawn as hollow nodes. The current head has an outer ring.
- Clicking a branch label other than the current branch opens the **Merge** tab with that branch preselected.
- Window: `lore.graph.maxRevisions` (default 100). A notice appears when older revisions are cut off.
- Archived branches that cannot be named show a short branch ID.

## 5. Merge (with graph)

The Merge tab shows the compact graph above a form.

1. Choose a source branch (any live local branch other than the current one).
2. The extension runs `branch diff --source <source> <current>` and shows changed files (diff opens in VS Code: left = target tip, right = source tip) and conflicts.
3. **Merge** runs `branch merge <source> --message <message>`; the default message is `Merge <source> into <current>`.
   - Output contains `Committed merged repository state`: success, graph refreshed, toast.
   - Output contains `Files in conflict:`: the working tree now holds the staged merge with conflict markers. The UI jumps to the Changes tab with a warning.
4. If the preview already shows conflicts the button reads "Merge and resolve N conflict(s)".

Preconditions: no pending merge, no staged/modified files, a configured remote (Lore requirement; without one the error "No remote configured" is shown). The preview warns when the current branch is `behind` or `diverged` from the remote.

## 6. Merge conflict resolution

Shown in the Changes tab while `status` reports `Changes in conflict`. Per file:

| Button | Command |
| --- | --- |
| Click the name | Opens the file; it contains diff3 markers, so VS Code's built-in "Accept Current/Incoming/Both" actions work |
| Take mine | `branch merge resolve mine <path>` |
| Take theirs | `branch merge resolve theirs <path>` |
| Mark resolved | `branch merge resolve <path>` (use after editing the file by hand) |

Banner "Merge in progress": **Abort merge** (modal confirmation) runs `branch merge abort`, which restores the working tree. Commit is blocked until every conflict is resolved. After the last conflict is resolved the user commits (section 2).

## 7. Fake pull request

Lore has no server-side pull requests. The Pull request tab emulates one.

Inputs: source branch, target branch (defaults to the repository's default branch, else `main`), title (required), description.

Live preview: the same branch comparison as in section 5, with changed files and conflicts. The **Create & merge** button is enabled only when: the comparison has changes, has no conflicts, a title is entered, the working tree has no staged/modified files, and no merge is pending.

Procedure (`LoreService.createPullRequest`):

1. Rescan; refuse if the tree is dirty or a merge is pending.
2. `branch diff --source <source> <target>`. Any conflict: stop and report the conflicting files. Nothing is changed.
3. No changes: stop with "nothing to merge".
4. `branch switch <target>` if not already there.
5. If a remote exists: `sync` to merge on top of the server state. A failure becomes a warning. If sync leaves a pending merge, stop with a message pointing to the Changes tab.
6. `branch merge <source> --message "<title>\n\n<description>"`.
   - Conflicts appear after all (state moved since the preview): `branch merge abort`, report the files.
   - Anything other than a committed merge: abort and fail with "rolled back".
7. If a remote exists: `push`. On failure add a warning and **skip archiving**, leaving the source branch usable.
8. If the push succeeded (or there is no remote): `branch archive <source>`.
9. Save a record: title, description, source/target, source tip, target tip before merge, merge signature, files, time, archived flag. Records appear under "Merged pull requests".

Outcome toasts: success ("Merged X into Y and archived the branch"), plus any warnings (merged locally but push failed; archived locally only because the server keeps the branch).

After a successful pull request the working tree is on the target branch.

## 8. Push and pull

- **Push**: `push` (current branch; creates the branch on the server if new). Toast shows the last output line. A failed push offers **Pull** in an error notification.
- **Pull**: `sync`. Summary text: "Already up to date.", "Merged remote changes into your branch. Push to publish the result." (diverged case), otherwise the last output line. If the sync leaves conflicts the UI jumps to the Changes tab.
- Both buttons are disabled when there is no remote.
- Header shows the sync state next to the branch: ahead `↑`, behind `↓`, diverged `⇅`.

## 9. Server health check

- Target URL: `http://<host of the repository's remote URL>:<lore.healthCheck.port>/health_check`, or `lore.healthCheck.url` if set.
- HTTP 2xx is healthy and records latency; any other status, timeout (4 s) or connection error is "Unreachable" with the error text. No remote configured: "No remote configured".
- Checked on activation, then every `lore.healthCheck.intervalSeconds` (default 30; 0 disables), on manual refresh, via the **Check now** button, and with `Lore: Check Server Health` (which also shows a notification).
- Shown as a dot in the header, in the status bar item (`$(pass-filled)` healthy, `$(error)` down), and in the Server tab together with repository details (name, ID, remote, default branch, creator, sync text, identity source).

## 10. Status bar and commands

The status bar item shows `<branch> <n>*` (number of changed files) and a health icon; clicking it opens the panel. Commands are listed in [ui-and-protocol.md](ui-and-protocol.md#commands).

## Out of scope for v1

Clone, locks, layers, links, cherry-pick, revert, bisect, file history/blame, branch protection, authentication flows (`lore auth`), multi-root workspaces, a built-in three-way merge editor, and switching to server-only branches.

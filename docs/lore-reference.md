# Lore reference

Lore is Epic Games' version control system (MIT licensed, Rust, https://github.com/EpicGames/lore). It is pre-1.0: the upstream README warns that interfaces, on-disk formats and APIs may change between releases. This document records what the extension depends on.

## Executables

| Name | Role |
| --- | --- |
| `lore` | Command line client |
| `loreserver` | Server. With no config it uses an ephemeral self-signed certificate, a temp store under `<temp>/lore-server`, and no auth |

Default server ports: **41337** (QUIC and gRPC, the `lore://` port) and **41339** (HTTP, health check).

## Data model

- **Repository**: a versioned tree of files under one access boundary. ID is 32 hex characters (UUIDv7).
- **Revision**: a frozen snapshot. Identified by a **signature** (64 hex characters, a BLAKE3 hash of the serialized state). It has one parent, or two for a merge. It also has a **revision number**.
- **Branch**: a named mutable pointer to a revision (its "latest"), with a stable 32-hex ID.
- **Fragment**: content stored by hash. Staging records intent only; fragments are created at commit time.
- **Stage vs dirty**: staging records intent to commit. A file is dirty when it differs from the committed revision.
- **Link / layer**: link mounts another repository at a path; layer is a local overlay. Neither is used by this extension.
- **Remote URL**: `lore://host:port/repo-name`.

**Revision numbers are per-branch counters, not unique.** `main` and a feature branch can both have a "revision 2". Always key revisions by signature.

## Global CLI flags

Always passed by the extension: `-P` (no pager) and `--non-interactive`. Optionally `--identity <name>` from the `lore.identity` setting.

Other flags exist (`--repository`, `--offline`, `--remote`, `--local`, `--dry-run`, `-f`, `--stats`, `--max-connections`, token flags). The extension runs lore with the workspace as its working directory instead of `--repository`.

`-P` is passed as a precaution: upstream documents a pager (`more.com` on Windows) that is disabled by it, and a pager waiting on a terminal would hang a child process. Hanging without `-P` was not reproduced. Token flags (`--identity-token`, `--access-token`) are unsafe on the command line, so the extension never uses them.

**There is no `--json` flag** (checked in `lore --help` and per-command help). All output is human text.

**Exit codes and streams (verified):** failures exit non-zero and print `[Error] <message>` plus `  at <source location>` lines on **stderr**. Warnings such as `Warning: Could not query remote branch list` go to stdout and do not fail the command.

## Commands used and their output

Every output below was captured from a real run. Whitespace is preserved as printed, including trailing spaces.

### Repository

```
lore --offline repository create <name>
lore repository create lore://host:port/<name>
```
`Created repository <name> in <path> with ID <32-hex>`. With a URL the repository is created on the server too. `--offline` makes a local-only repository (merge, push, sync then fail with `No remote configured`).

```
lore repository info
demo2 (01a1725a88f27d10b8aa85ac1f823719)

Remote URL: lore://127.0.0.1:41337
Default branch: main (e726318bbc3fd75ac8733a7e030cc35b)
Creator: tester
Created: Sun, 25 Oct 2026 09:18:18 +0000
Instance: 01a1725a890579f1ae64b58a53f80d6c
```
The remote URL here lacks the repository name. An offline repository has no `Remote URL` line.

Repository detection by the extension: the workspace folder contains a `.lore` directory.

### Status

```
lore status [--scan] [paths...]
```
Without `--scan` only already-known dirty flags are reported, so edits made outside lore do not appear. `--scan` walks the file system and persists the dirty flags (it only writes inside `.lore`).

```
Repository <32-hex id>
On branch <name> revision <n> -> <64-hex signature>
Remote revision <n> -> <signature>            (absent when no remote)
Local branch in sync with remote              | Local branch is ahead of remote
                                              | Local branch has diverged, synchronize to merge
Remote branch does not exist                  (instead of the two Remote lines, branch never pushed)
Pending merge, incoming revision <signature>  (only during a merge)
Changes staged for commit:
A b.txt 
Changes not staged for commit:
M a.txt
D sp ace.txt
Untracked files:
A c.txt
Changes in conflict:
M  a.txt (M)!
Tracked changes: 1 added, 1 modified         | No tracked changes
```
Rules the parser follows:

- Section headers decide the category. Entries are `<letter><spaces><path>`; paths may contain spaces.
- A trailing `!` marks a conflict. A trailing `(X)` is secondary information and is dropped.
- A new repository with no commits reports revision `0` and an all-zero signature.
- The remote revision comes from the last sync or push, not from a live query. "Behind" is therefore not shown until you sync. Verified: after another clone pushed, `status` still said "in sync".

### Staging

```
lore stage <paths...>        Staging N files (a modified, b added, c deleted, d moved)
lore unstage <paths...>
lore reset <paths...>        restores modified and deleted files to the committed version
lore reset --purge <paths>   also deletes the named untracked files (verified: only those files)
```
`stage` covers add, modify and delete.

### Commit

```
lore commit <message>
Committed 1/1 directories, 2/2 files, 12 bytes/12 bytes (2 modified, 0 deleted)
Repository: <id>
Revision  : 1
Signature : <sig>
Parent    : <sig>          (printed only when the parent is on another branch)
Branch    : <branch id>
Date      : Sun, 25 Oct 2026 09:18:01 +0000
    first
Creator   : tester
Committer : tester
Commit succeeded
```
Without an identity the upstream docs say it fails with `No commit identity configured; pass --identity or set identity in .lore/config.toml`. (This machine had a global identity, so the failure was not reproduced.) During a merge, `lore commit` commits the merge and adds `Parent` twice or a `Merger` line.

### History

```
lore history [length] [--branch <name>] [--revision <rev>] [--only-branch] [--oneline]
```
Output is one block per revision, newest first:

```
Revision  : 3
Signature : <sig>
Merge     : <sig>        (merge commits: the second parent)
Branch    : <branch id>
Merger    : tester       (merge commits)
Date      : ...
    <message, indented four spaces; may span lines>
Creator   : tester
Committer : tester
```

- `Parent` appears only when the parent lives on a different branch (for example the first commit on a new branch). Otherwise the first parent is the next block.
- `history --branch <name>` fails for archived branches (`branch not found`). `history --revision <signature>` still walks them, which is how the graph recovers merged branches.
- `--oneline` prints `<revision> <message>`.

### Branches

```
lore branch list [--archived]
Local branches:
  feat
* main
Archived local branches:       (only with --archived)
  old-work
Remote branches:               (only when the server is reachable)
  main
Warning: Could not query remote branch list    (offline or unreachable)
```
`* ` marks the current branch.

```
lore branch info <name>
Branch main
  ID: <32-hex>
  Latest: <signature>
  Remote Latest: <signature or zeros>
  Created: ...
```

```
lore branch create <name>      Created branch <name> at revision <sig>   (does not switch)
lore branch switch <name>      Switched to branch <name> revision <sig>
lore branch archive <name>     Archived branch <name>                    (local only)
```
Verified behavior:

- `branch create` branches from the current revision and does not switch.
- `branch switch` rewrites the working tree. Uncommitted changes are the caller's problem; the extension refuses to switch with staged or modified files.
- `lore push` on a new branch **creates it on the server** (`Creating branch X at <sig>`).
- `branch archive` hides the branch locally. The server keeps it; Lore exposes no command to delete a remote branch.

### Branch diff

```
lore branch diff --source <feature> <base>
Branch diff branch <id> revision <sig> -> branch <id> revision <sig>
Revision diff base <sig> source <sig> target <sig>
Found 4 changes
M a.txt
D f.txt
A g.txt
A sp ace.txt
Found 1 conflicts          (only when conflicts exist)
C a.txt
```
This compares against the common ancestor and does not touch the working tree or switch branches. **Direction matters:** the changes listed are what `--source` adds relative to the positional argument. With the arguments reversed the output is empty or misleading. The extension always runs it as `--source <source> <target>`.

### Merge

```
lore branch merge <source> --message <msg>
```
Clean merge, which also commits (exit 0):
```
Starting merge of branch <id> revision <sig>
Merged files, 3 updated, 1 deleted, 0 merged, 0 conflicted
Staged merged repository state <sig>
Fragmenting files and updating tree hashes
Stored history for 3 nodes
Committed merged repository state 6 -> <sig>
```
Conflicted merge (also exit 0, nothing committed):
```
Starting merge of branch <id> revision <sig>
Merged files, 0 updated, 0 deleted, 0 merged, 1 conflicted
Staged merged repository state <sig>
Files in conflict:
a.txt
```
Success and conflict can only be told apart by the text (`Committed merged repository state` vs `Files in conflict:`), not the exit code. Requires a configured remote (`No remote configured` otherwise).

Conflicted files in the working tree use **diff3** markers:
```
line1
<<<<<<< ours
MAIN
||||||| original
line2
=======
FEAT
>>>>>>> theirs
line3
```
Merge subcommands, verified:

| Command | Effect |
| --- | --- |
| `branch merge resolve <paths>` | Marks the files resolved, keeping whatever is in the working tree (after hand editing) |
| `branch merge resolve mine <paths>` | Takes the current branch's version and resolves |
| `branch merge resolve theirs <paths>` | Takes the incoming version and resolves |
| `branch merge unresolve <paths>` | Marks the files unresolved again |
| `branch merge abort` | Reverts the working tree and index to before the merge (`Merge abort reverted changes`); errors with `No merge is in progress` otherwise |
| `branch merge restart <paths>` | Resets a file's merge state (requires paths; not used by the extension) |

After all conflicts are resolved, `lore commit <message>` creates the merge revision with two parents.

### Push and sync

```
lore push                     Pushed revision 1 -> <sig> to branch main
lore sync                     Already on branch main latest revision 4 -> <sig>
```
Verified:

- If the remote moved and your branch did not, `sync` fast-forwards.
- If both moved, `sync` merges automatically (`Remote and local branch have diverged, performing merge`). The result shows as "diverged" in `status` until pushed.
- `push` on a diverged branch fails: `[Error] Branch has diverged, sync to merge remote changes`.
- `sync` conflicts are expected to leave the same pending-merge state as `branch merge` (unverified).
- There is no `pull` command; `sync` replaces it.
- `sync` updates the current branch only.

### Reading a file at a revision

```
lore file write --path <repo-relative path> --revision <signature|number> --output <file>
```
Accepts a signature or a revision number (resolved on the current branch). A branch name fails: `revision not found: main`. A path missing at that revision fails with a `not found` message, which the extension maps to empty content.

### Other relevant facts

- Unified diff: `lore diff [paths]` prints `--- a.txt@1` / `+++ a.txt` hunks. The extension uses VS Code's own diff editor instead.
- Health check: `GET http://<host>:41339/health_check` returns `200 OK` with an empty body when healthy. There is no `lore ping`; `lore service status` is about the local background service, not the server.
- Ignore files: `.loreignore`. Per-repository config: `.lore/config.toml` (`remote_url`, `identity`, `[store]`, `[file]`).
- Unverified: `branch switch` to a branch that exists only on the server; behavior of `lock`, `link`, `layer`, `clone` flags beyond the basics.

## Upstream references

- Docs: https://epicgames.github.io/lore/ (CLI reference: `/reference/lore-cli-commands/`, system design: `/explanation/system-design/`, quickstart: `/tutorials/quickstart/`)
- Source: https://github.com/EpicGames/lore
- SDKs exist for JavaScript, Python, .NET and Go (not used here; the extension shells out to the CLI).

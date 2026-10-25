# Lore for VS Code

Manage [Lore](https://epicgames.github.io/lore/) repositories from an activity-bar view or a full-size panel.

The extension drives the `lore` command line tool. There is no separate backend process.

## Features

| Tab | What it does |
| --- | --- |
| Changes | Stage and unstage, discard, commit, open a native diff against the current revision. Shows merge conflicts with *Take mine*, *Take theirs* and *Mark resolved*, plus *Abort merge*. |
| History | Branch graph across all branches, with merge commits. Click a branch label to start a merge. |
| Branches | Create and switch branches, archive branches, see branches that only exist on the server. |
| Merge | Pick a source branch, preview the changes and conflicts (`lore branch diff`), then merge into the current branch. Clean merges commit on their own; conflicts hand over to the Changes tab. |
| Pull request | Lore has no pull requests, so this emulates one: compare two branches, refuse if they conflict, otherwise merge the source into the target, push the target and archive the source. Merged requests are remembered per repository. |
| Server | Health of the Lore server (`/health_check`), repository details, link to the command log. |

Push and Pull (`lore sync`) are in the header. A status bar item shows the branch, number of changes and server health.

Open the full panel with **Lore: Open Panel**. Other commands: Refresh, Create Branch, Switch Branch, Push, Pull, Create Pull Request, Check Server Health, Initialize Repository, Show Command Log.

## Requirements

- The `lore` CLI on your `PATH` (or set `lore.path`).
- For push, pull, merge and the pull request flow: a repository with a remote (`lore://host:port/name`). Offline repositories can stage, commit and branch.

## Settings

| Setting | Default | |
| --- | --- | --- |
| `lore.path` | `lore` | Path to the executable. |
| `lore.identity` | empty | Passed as `--identity`. Empty uses `.lore/config.toml`. |
| `lore.autoRefresh` | `true` | Refresh when workspace files change. |
| `lore.healthCheck.port` | `41339` | HTTP port of the server health endpoint. It differs from the `lore://` port. |
| `lore.healthCheck.url` | empty | Full health URL; overrides the one derived from the remote. |
| `lore.healthCheck.intervalSeconds` | `30` | `0` disables polling. |
| `lore.graph.maxRevisions` | `100` | Revisions shown in the graph. |

## Known limitations (v1)

- Lore prints human-readable text and has no JSON mode (checked against lore 0.10.1), so output is parsed. The parsers are tested against captured output in `src/test/fixtures.ts`; a CLI update that changes wording may need parser changes.
- Archiving is local: Lore has no command to remove a branch from the server.
- Pull requests are not stored on the server. The history of merged requests lives in VS Code's workspace state.
- Pull runs `lore sync`: it fast-forwards, or merges automatically when your branch and the remote have diverged (conflicts then show up in the Changes tab). `lore status` only knows the remote state from the last sync or push, so "behind" is not detected until you pull.
- Conflicts are edited as files (Lore writes diff3 markers); VS Code's built-in merge conflict actions work on them. There is no three-way merge editor.
- Branches that exist only on the server are listed but cannot be switched to from the UI (`lore sync` only updates the current branch, and switching to them has not been verified).
- No clone, locks, layers or links.

## Development

```
npm install
npm run compile        # builds dist/extension.js and dist/webview.js
npm run test:unit      # parser and graph tests (no VS Code needed)
npm run lint
```

Press F5 to start an Extension Development Host. Source layout:

- `src/lore/` CLI wrapper, parsers, graph layout, the service that holds state
- `src/ui/` webview hosting, message handling, diff content provider
- `src/shared/protocol.ts` message types shared with the webview
- `src/webview-ui/` React app, bundled by the second webpack config
- `media/` stylesheet and icon

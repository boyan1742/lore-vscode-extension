# Architecture

## Decision: CLI wrapper, no backend

The extension executes the `lore` CLI and parses its text output. A .NET or other RPC backend was considered and rejected: the CLI covers every feature, a second runtime adds build and packaging cost, and Lore's own SDKs would not remove the parsing risk for the operations used here. The cost of this choice is parser fragility (see [testing.md](testing.md) for how it is contained).

## Layers

```
┌─────────────────────────────┐   postMessage (typed)   ┌───────────────────────────┐
│ Webview (React, browser)    │ <─────────────────────> │ Controller (extension     │
│ src/webview-ui              │   src/shared/protocol   │ host) src/ui/controller   │
└─────────────────────────────┘                         └─────────────┬─────────────┘
                                                                      │ method calls
                                                        ┌─────────────▼─────────────┐
                                                        │ LoreService  src/lore     │
                                                        │ state + operations        │
                                                        └──────┬───────────┬────────┘
                                              execFile (queue) │           │ http.get
                                                        ┌──────▼──────┐ ┌──▼─────────┐
                                                        │ lore CLI    │ │ /health_   │
                                                        │ (LoreCli)   │ │ check      │
                                                        └─────────────┘ └────────────┘
```

The extension host owns all state. The webview holds only UI state (selected tab, commit message draft, form fields). It never runs commands and never reads files.

## Source map

| Path | Responsibility |
| --- | --- |
| `src/extension.ts` | Activation, command registration, content provider, view provider |
| `src/lore/cli.ts` | `LoreCli`: spawns `lore`, serializes calls, strips ANSI, maps failures to `LoreError` |
| `src/lore/parsers.ts` | Pure text parsers for status, branches, history, branch diff, merge output, repository info |
| `src/lore/graph.ts` | Pure graph builder: topological order and lane assignment |
| `src/lore/health.ts` | Health URL resolution and the HTTP check |
| `src/lore/service.ts` | `LoreService`: cached state, every user operation, pull request emulation |
| `src/ui/controller.ts` | One per window: owns the service, file watcher, health timer, status bar, request dispatch |
| `src/ui/webviews.ts` | HTML/CSP generation, sidebar `WebviewViewProvider`, panel manager |
| `src/ui/diffProvider.ts` | `lore:` content provider and diff-editor openers |
| `src/shared/protocol.ts` | Types shared with the webview (type-only) |
| `src/webview-ui/` | React app: `App`, `Changes`, `Graph`, `Branches`, `Merge`, `PullRequest`, `Server`, `Compare` |
| `media/` | `lore.css` (uses VS Code theme variables), `lore.svg` (activity bar icon) |
| `src/test/` | Unit tests and captured-output fixtures |

`src/lore/*` imports nothing from `vscode`, so it can be tested and smoke-run under plain Node.

## Command execution (`LoreCli`)

- `execFile` with an argument array; no shell, so paths and messages with spaces or quotes are safe.
- Fixed prefix `-P --non-interactive`, then `--identity <name>` if configured.
- `NO_COLOR=1`, ANSI stripped anyway, output split on `\r?\n`.
- **One queue per repository.** Every call, reads included, is chained on the previous one. Lore takes repository locks and the UI issues overlapping requests (refresh while staging), so serialization removes races at the cost of some latency.
- Failure: non-zero exit becomes `LoreError(message, exitCode, stdout, stderr, args)`. The message is the first `[Error]` line. A missing executable gives `exitCode === null` and the text "Could not run lore. Install the Lore CLI or set lore.path", which the service reports as `cliError` and the webview shows as a full-screen retry banner.
- Default timeout 10 minutes, 64 MiB output buffer. Every command and its output is written to the **Lore** output channel (`Lore: Show Command Log`).

## State and refresh (`LoreService`)

Cached fields: `status`, `branches` (enriched with ID and latest via `branch info`), `repoInfo`, `graph`, `health`, `pullRequests`, `busy`, `lastError`, `cliError`. `snapshot()` produces the serializable `Snapshot` sent to webviews. Any change calls `emit()`, which the controller turns into a broadcast.

`refresh({scan, graph})` runs `status [--scan]` and `branch list --archived` in parallel, then `branch info` per branch, loads `repository info` once, and rebuilds the graph if any view has asked for it.

Refresh triggers:

| Trigger | Scan |
| --- | --- |
| Activation, manual refresh, after every mutating operation | yes |
| Workspace file change (debounced 800 ms, `.lore/**` ignored, skipped while busy) | yes |
| Webview ready | no (graph on) |
| Settings change | no |

`.lore/**` is excluded from the watcher because lore rewrites files there on every command, which would otherwise make refreshes trigger themselves.

`operation(label, work)` wraps every user action: sets `busy`, captures the error into `lastError`, always refreshes afterwards (also on failure), and rethrows so the controller can toast it.

Guard `assertNoPendingWork` runs a fresh scan and refuses `switchBranch`, `merge` and `createPullRequest` when a merge is pending or files are staged/modified. The cached status is deliberately not trusted here.

## Graph pipeline

1. For every live local branch: `history --branch <name> <N>` (N is `lore.graph.maxRevisions`).
2. Parse and union by signature.
3. For merge or explicit parents not yet known (typically archived branches), fetch `history --revision <signature> <N>`, up to 20 times.
4. `buildGraph` orders children before parents (newest first among ready nodes), assigns lanes, and returns rows plus edges. See [ui-and-protocol.md](ui-and-protocol.md#graph-layout).

## Diff content (`lore:` scheme)

`lore:/<repo-relative-path>?sig=<signature>` is served by `LoreContentProvider`, which runs `file write --path --revision --output <tmp>` into a temp directory, reads it and deletes the directory. An empty `sig` yields empty content (used for the missing side of added or deleted files). Working-tree diffs compare `lore:` at the current head against the real file; branch diffs compare two `lore:` URIs at the branch tips.

## Pull request storage

Records are kept in `ExtensionContext.workspaceState` under `lore.prs.<repositoryId>`, newest first, capped at 100. They exist only on the local machine.

## Build

Two webpack configs in `webpack.config.js`:

| Config | Target | Entry | Output | TS config |
| --- | --- | --- | --- | --- |
| extension | node, `vscode` external, commonjs2 | `src/extension.ts` | `dist/extension.js` | `tsconfig.json` |
| webview | web | `src/webview-ui/index.tsx` | `dist/webview.js` | `src/webview-ui/tsconfig.json` (JSX, DOM lib, bundler resolution) |

The webview config defines `process.env.NODE_ENV` through `DefinePlugin` from the webpack mode. Without it, React's entry files reference `process` and the webview fails with `ReferenceError` in development builds.

The root `tsconfig.json` excludes `src/webview-ui`, which is type-checked separately (`tsc -p src/webview-ui --noEmit`, part of `npm run compile-tests`). `eslint.config.mjs` covers `.ts` and `.tsx`.

## Security

- Webview CSP: `default-src 'none'`; scripts only with a per-load nonce; styles, fonts and images only from the extension's webview origin. No inline styles or scripts in the HTML. React sets styles through the CSSOM, which the CSP permits.
- `localResourceRoots` is the extension directory only.
- All commands use argument arrays. User text (branch names, messages, paths) is never interpolated into a shell string.
- The extension never writes `.lore/config.toml`; identity comes from the `lore.identity` setting passed as a flag.
- Token flags are never used.

## Known design limits

- Parsers depend on human-readable output. A wording change in a future Lore release can break them; fixtures in `src/test/fixtures.ts` document the expected shapes.
- The service is single-root: it uses the first workspace folder containing `.lore`, else the first folder. Multi-root workspaces with several repositories are not supported.
- Remote state is only as fresh as the last sync/push; there is no polling of the server for new revisions.

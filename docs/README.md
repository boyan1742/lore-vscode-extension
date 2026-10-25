# Documentation

| Document | Contents |
| --- | --- |
| [lore-reference.md](lore-reference.md) | What Lore is, its data model, and the exact CLI behavior and output formats this extension relies on |
| [architecture.md](architecture.md) | Layers, data flow, state, concurrency, build setup |
| [feature-specs.md](feature-specs.md) | Per-feature specification: commands run, preconditions, outcomes, error handling |
| [ui-and-protocol.md](ui-and-protocol.md) | Webview screens, message protocol, settings, commands, graph layout |
| [testing.md](testing.md) | Unit tests, fixtures, the end-to-end smoke procedure, manual test plan |

Conventions used throughout:

- **Verified** means observed against `lore 0.10.1+1476` and `loreserver` on Windows while building this extension.
- **Documented** means stated by the upstream Lore docs (https://epicgames.github.io/lore/) but not exercised here.
- **Unverified** means neither; treat as a risk.

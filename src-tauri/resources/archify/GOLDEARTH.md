# GoldEarth integration

Vendored from the locally installed Archify skill (release 2.17, package
2.17.0-dev.1). The upstream runtime is retained without modifications. License
and third-party notices are included beside this file. No npm installation is
required. Node.js 18 or newer is required at runtime; `GOLDEARTH_NODE` may point
to a portable Node executable.

GoldEarth exposes only template loading, generation task preparation, validated
delivery, and a native save dialog. It uses the `deliver --quality showcase`
receipt before displaying or exporting HTML. Temporary rendering directories
are removed after each operation. Agent task files are kept in the application
cache under `archify-prompts` so a running or resumed Agent can read its task.

The viewer runs in a sandboxed iframe with scripts and downloads enabled and
without same-origin access to the application. PNG/JPEG/WebP/SVG/WebM exports
remain upstream viewer capabilities and depend on WebView/browser support;
the native HTML and JSON export buttons use a system file dialog.

The five starter examples retain the upstream sample domain labels and use
Chinese viewer controls. The workflow starter uses schema version 2. Natural
language and Mermaid conversion use a configured, enabled file-capable Agent
(for example Codex or Claude Code), supplied with the bundled schemas and real
validation diagnostics when repairing. AI generation may use the network;
manual JSON rendering and standalone HTML viewing run locally.

Generation tasks provide a private candidate directory and the bundled CLI's
showcase validation command so file-capable Agents can validate before replying.
After an Agent reply, the application always validates the returned JSON itself.
Diagram failures automatically feed the exact candidate and receipt back to the
same Agent for at most two further attempts. Runtime failures are never sent to
an Agent for layout repair. All retries preserve the showcase acceptance gate.

The preview button also performs a bounded local repair of measured architecture
label/route clearance issues and small redundant viewBox margins. Each change
is revalidated through the real CLI. The editor and saved draft receive the exact
validated source; no relationships or labels are removed. Unknown diagnostics
are retained for the user or Agent instead of bypassing acceptance.

# Morrow Presenter design principles

## 1. Shell is a first-class interface

The GUI is not the authority. The `.morrowdeck` document is the authority.

Every persistent user-visible operation must be possible from a normal shell without GUI automation and without MCP. The CLI and GUI operate the same document model.

A feature is not complete until it has:

1. a representation in the deck format when it affects document state;
2. a shell-reachable operation;
3. machine-readable output where an agent needs to inspect the result;
4. documentation in `docs/AGENT.md`;
5. validation that the GUI and CLI do not diverge.

MCP may exist later as a convenience adapter. It must never be required for an agent to operate Presenter.

## 2. Agent operations should be non-disruptive

Shell and agent activity should not steal the user's focus unless foreground UI is the explicit purpose of the command.

- Editing commands never launch the app.
- `morrow-presenter open deck.morrowdeck` opens the editor in the background.
- A manually launched app behaves like a normal Mac app.
- `morrow-presenter present deck.morrowdeck` is intentionally foreground because its explicit purpose is presentation.
- Build, install, discovery, validation, and registration must not open Finder or bring Presenter to the front.

## 3. Files over hidden application state

`.morrowdeck` is UTF-8 JSON and is intentionally inspectable, diffable, versionable, and scriptable.

The app must not require a hidden database to reconstruct the presentation. GUI autosave writes the document atomically. When the same open document is changed from the shell, the app reloads the external change instead of overwriting it with stale GUI state.

## 4. Stable identity for agent edits

Slides have stable IDs in addition to human-friendly positions. Agents should use IDs across multi-step mutation sequences because positions can change after insert, delete, or move operations.

## 5. Capability discovery should not require prose knowledge

The CLI exposes:

```bash
morrow-presenter capabilities --json
morrow-presenter schema --json
```

An agent can discover the command surface and document schema from the executable itself. Human-oriented docs supplement this contract rather than replace it.

## 6. Lightweight local implementation

Presenter should remain local-first and small. The current Mac app uses AppKit/WebKit rather than shipping a second browser runtime. The UI can evolve quickly in HTML/CSS/JS while native code owns Mac-specific document, window, and presentation behavior.

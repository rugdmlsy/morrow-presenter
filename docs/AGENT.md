# Agent Interface

Morrow Presenter is shell-first. An agent must be able to create, inspect, edit, reorder, open, and present a deck without GUI automation and without MCP.

The stable entry point is:

```bash
morrow-presenter <command> ...
```

Run this first when discovering the tool:

```bash
morrow-presenter capabilities --json
```

The CLI only uses local files and standard OS process launching. It does not require a running Presenter app.

## Deck references

A slide can be addressed by either:

- 1-based position, such as `1`, `2`, `3`
- stable slide UUID returned by `slides --json`

Use UUIDs when performing several mutations because positions can change after add/delete/move operations.

## Core workflow

```bash
# Create
morrow-presenter new talk.morrowdeck --title "Weekly Research Update"

# Inspect
morrow-presenter info talk.morrowdeck --json
morrow-presenter slides talk.morrowdeck --json
morrow-presenter get talk.morrowdeck 1 --json

# Edit
morrow-presenter set talk.morrowdeck 1 --title "Reliable agents need recovery"
morrow-presenter add talk.morrowdeck --after 1 --layout title-body \
  --title "Problem" \
  --body $'Agents change external systems.\nFailures can outlive the agent step.'
morrow-presenter duplicate talk.morrowdeck 2
morrow-presenter move talk.morrowdeck 3 --to 2
morrow-presenter delete talk.morrowdeck 3
morrow-presenter title talk.morrowdeck "ARP Weekly Update"

# Validate before handoff/presentation
morrow-presenter validate talk.morrowdeck --json

# Open or present in the Mac app
morrow-presenter open talk.morrowdeck
morrow-presenter present talk.morrowdeck --slide 1
```

`open` is deliberately non-activating when launched from the CLI: it may open an editor window, but it must not take keyboard focus away from the user's current app. `present` is the exception because starting a slideshow is explicitly a foreground operation.

For long or generated bodies, avoid shell escaping by using stdin or a file:

```bash
cat notes.txt | morrow-presenter set talk.morrowdeck 2 --body-file -
morrow-presenter add talk.morrowdeck --body-file section.txt
```

## Machine-readable output

Mutation and inspection commands accept `--json`. Prefer it for agent workflows.

Success uses exit code `0`. Invalid arguments, invalid deck content, missing files, or failed launches use exit code `2` and write the error to stderr.

Useful discovery commands:

```bash
morrow-presenter capabilities --json
morrow-presenter schema --json
morrow-presenter --help
morrow-presenter set --help
```

## GUI/CLI coexistence

A `.morrowdeck` is the source of truth. The Mac app and CLI use the same JSON document format.

When a deck is open in the Mac app and an agent changes that file through the CLI, the app watches the file and reloads the external change automatically. Native GUI edits autosave atomically once the deck has a file path.

This means an agent should edit the deck file directly with `morrow-presenter` rather than driving buttons or text fields through accessibility/browser automation.

For normal editing, prefer CLI mutations and do not launch the app at all. Use `open` only when the user asks to see the editor, and use `present` only when the user asks to begin presentation.

## Supported operations

| Intent | Shell command |
| --- | --- |
| Create deck | `new` |
| Inspect deck | `info` |
| List slides | `slides` |
| Inspect slide | `get` |
| Rename deck | `title` |
| Add slide | `add` |
| Edit slide | `set` |
| Duplicate slide | `duplicate` |
| Delete slide | `delete` |
| Reorder slide | `move` |
| Validate file | `validate` |
| Normalize/export copy | `export` |
| Open editor | `open` |
| Start slideshow | `present` |
| Discover capability surface | `capabilities` |
| Discover file schema | `schema` |

## Design rule for future features

Do not add a user-visible persistent operation only to the GUI. Every new persistent operation must have:

1. a deck-format representation when relevant;
2. a shell command or shell-reachable operation;
3. machine-readable output for agent use;
4. documentation here before the feature is considered complete.

MCP may be added later as an adapter, but it must not be the only way an agent can operate Presenter.

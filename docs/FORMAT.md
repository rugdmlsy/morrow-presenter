# `.morrowdeck` format

A `.morrowdeck` file is UTF-8 JSON. Version 1 is intentionally simple and diff-friendly.

```json
{
  "version": 1,
  "title": "Weekly Research Update",
  "selectedId": "8a40c50d-2a60-42a0-b2c3-574f46c3da83",
  "slides": [
    {
      "id": "8a40c50d-2a60-42a0-b2c3-574f46c3da83",
      "layout": "title",
      "title": "Reliable agents need recovery",
      "body": ""
    }
  ]
}
```

Fields:

- `version`: currently `1`.
- `title`: deck title.
- `selectedId`: UI selection hint. It must reference a slide ID; invalid values are normalized to the first slide.
- `slides`: non-empty ordered slide array.
- `slides[].id`: stable unique string. The CLI uses UUIDs.
- `slides[].layout`: `title-body`, `title`, or `section`.
- `slides[].title`: UTF-8 string.
- `slides[].body`: UTF-8 string; newlines are preserved.

The CLI normalizes malformed optional fields and refuses structurally invalid decks. Use the live machine-readable schema when generating files:

```bash
morrow-presenter schema --json
```

Prefer the CLI for mutations instead of editing JSON with ad-hoc scripts because the CLI preserves IDs, validates slide references, writes atomically, and keeps the format normalized.

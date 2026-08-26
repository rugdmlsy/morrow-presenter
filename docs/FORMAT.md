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
      "body": "",
      "image": {
        "path": ".morrow-assets/4566b637ae298d756c193d3e.jpg",
        "alt": "Architecture diagram",
        "fit": "contain",
        "placement": "right"
      }
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
- `slides[].image`: optional main image for the slide.
  - `path`: relative asset path. Presenter-managed assets live under `.morrow-assets/`; absolute paths and `..` are rejected.
  - `alt`: accessibility/agent description.
  - `fit`: `cover` or `contain`.
  - `placement`: `right`, `left`, `background`, or `full`.

## Image assets

Images are files, not base64 embedded in JSON. `morrow-presenter image-set` copies the source into a sibling `.morrow-assets/` directory using a content-hash filename, so repeated imports are deduplicated. Supported MVP formats are PNG, JPEG, GIF, WebP, HEIC and HEIF.

When `morrow-presenter export` writes a deck to another directory, referenced image assets are copied with it. Moving a deck manually should therefore move its `.morrow-assets/` directory as well.

The CLI normalizes malformed optional fields and refuses structurally invalid decks. Use the live machine-readable schema when generating files:

```bash
morrow-presenter schema --json
```

Prefer the CLI for mutations instead of editing JSON with ad-hoc scripts because the CLI preserves IDs, validates slide references, writes atomically, and keeps the format normalized.

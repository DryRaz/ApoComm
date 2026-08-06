# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

The repository holds two independent static tools for Apostello Comm, plus this documentation. No build system, package manifest, or test suite anywhere — plain HTML/CSS/JS with zero dependencies throughout.

Run either tool locally with any static file server, e.g. `python3 -m http.server 8000` from the repo root, then open the relevant path below. There is no build or lint step. There is no automated test suite; verify changes by exercising the tool in a browser (or headless via Playwright, already available in this environment).

## Architecture

### Registration form (`index.html`, `style.css`, `app.js` at repo root)

Captures a missionary's self-registration and outputs a 36-column TSV row.

- `index.html` — the form markup. Field `id`/`name` attributes match the TSV column names used by `app.js`; checkbox groups (`RequestedServices`, `Channels`) share a `name` and are read via `querySelectorAll`.
- `app.js` — all logic, in one IIFE:
  - `REQUIRED_TEXT_FIELDS` / `REQUIRED_GROUP_FIELDS` define what blocks submission; `validate()` enforces them and writes inline errors.
  - `analyzeSecurity()` scans `MissionSummary` against `SECURITY_KEYWORDS` (phrases implying a need for discretion) to set `SecuritySensitive`. When `YES`, `SecurityInstructions` is left blank for a human to fill, and the UI shows a blocking security notice — this mirrors the security-first rule in the `apostello-onboarding` skill.
  - `nextClientId()` generates `APC-YYYY-000` by incrementing a per-year counter in `localStorage` — there is no backend, so this is a client-only sequence, not a durable/shared one.
  - `completionStats()` computes completion across the 17 required fields (the 16 form-required fields plus the always-derived `SecuritySensitive`), matching the `%_Complétude` concept from the spreadsheet this data is destined for.
  - `buildRow()` / `TSV_COLUMNS` assemble the 36-column tab-separated row, in the exact column order the destination spreadsheet expects. `sanitize()` strips tabs/newlines from every value so the TSV can't be corrupted by free-text input.
- No network calls: this stage only captures, validates, and displays TSV for manual copy-paste. There is intentionally no Google Sheets/Gmail integration — see domain context below for where that logic lives conceptually.

### Site generator (`site-generator/index.html`, `site-generator/style.css`, `site-generator/app.js`)

Takes one pasted 36-column TSV row (the same format the registration form produces) and generates a single self-contained HTML file — a one-page public site for that missionary.

- `parseRow()` splits on the first non-blank line, then on `\t`; it deliberately does not `.trim()` the whole line before splitting, since trailing empty columns (e.g. `Notes` blank) end the row in real tab characters that a blanket trim would eat, undercounting columns.
- `evaluateSecurityGate()` is the security gate, checked before anything is generated: `SecuritySensitive = YES` with empty `SecurityInstructions` blocks generation outright (no preview, no decision summary — nothing rendered). `YES` with instructions present generates the site but treats `SecurityInstructions` as an allow-list for `CountryOfService`/`CityOfService`, evaluated by `isLocationFieldAllowed()`.
- `isLocationFieldAllowed()` reads `SecurityInstructions` clause by clause (split on `.`/`;`/newline). A clause permits `country` or `city` only if it contains the keyword plus an explicit allow word (`ok`, `allowed`, `share`, `publish`, ...) with no negation word (`not`, `never`, `don't`, ...) in that same clause. Silence or ambiguity defaults to hidden — this is the safety-critical piece, so precision was favored over cleverness.
- `buildSiteHtml()` assembles the output document, escaping every interpolated value via `escapeHtml()` (the generated page is real HTML served to the public, so free-text fields like `MissionSummary` must not be able to inject markup/scripts). The `Email` field is never printed as visible text — only used inside a `mailto:` href behind a generic "Get in touch" label.
- The photo section is three placeholder `.photo-slot` divs, each preceded by an HTML comment (`<!-- PHOTO n: replace... -->`) marking where to paste a real `<img>` later.
- `SITE_CSS` is inlined into the generated page's `<style>` tag so the output is a single portable file with no external requests (no font/CDN loads).
- The generator UI shows a `security-decision` summary (SecuritySensitive value, and whether country/city will be shown) so a human can audit the gate's decision before trusting or publishing the output.

## Domain context

Apostello Comm is a communications agency serving missionaries. Client (missionary) records live in a Google Drive spreadsheet ("Apostello Comm — Base Missionnaires"), not in this repository. Operational rules for handling missionary client data (record format, required fields, security handling for missionaries in restricted-access countries, email drafting rules) are defined in the `apostello-onboarding` skill available in this environment — invoke it for any task involving missionary contacts, client records, or missionary-facing content, rather than improvising the process here.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

The repository holds a single static page: a missionary self-registration form (`index.html`, `style.css`, `app.js`). No build system, package manifest, or test suite — plain HTML/CSS/JS with zero dependencies.

Run it locally with any static file server, e.g. `python3 -m http.server 8000` from the repo root, then open `http://localhost:8000/index.html`. There is no build or lint step. There is no automated test suite; verify changes by exercising the form in a browser (or headless via Playwright, already available in this environment).

## Architecture

- `index.html` — the form markup. Field `id`/`name` attributes match the TSV column names used by `app.js`; checkbox groups (`RequestedServices`, `Channels`) share a `name` and are read via `querySelectorAll`.
- `app.js` — all logic, in one IIFE:
  - `REQUIRED_TEXT_FIELDS` / `REQUIRED_GROUP_FIELDS` define what blocks submission; `validate()` enforces them and writes inline errors.
  - `analyzeSecurity()` scans `MissionSummary` against `SECURITY_KEYWORDS` (phrases implying a need for discretion) to set `SecuritySensitive`. When `YES`, `SecurityInstructions` is left blank for a human to fill, and the UI shows a blocking security notice — this mirrors the security-first rule in the `apostello-onboarding` skill.
  - `nextClientId()` generates `APC-YYYY-000` by incrementing a per-year counter in `localStorage` — there is no backend, so this is a client-only sequence, not a durable/shared one.
  - `completionStats()` computes completion across the 17 required fields (the 16 form-required fields plus the always-derived `SecuritySensitive`), matching the `%_Complétude` concept from the spreadsheet this data is destined for.
  - `buildRow()` / `TSV_COLUMNS` assemble the 36-column tab-separated row, in the exact column order the destination spreadsheet expects. `sanitize()` strips tabs/newlines from every value so the TSV can't be corrupted by free-text input.
- No network calls: this stage only captures, validates, and displays TSV for manual copy-paste. There is intentionally no Google Sheets/Gmail integration — see domain context below for where that logic lives conceptually.

## Domain context

Apostello Comm is a communications agency serving missionaries. Client (missionary) records live in a Google Drive spreadsheet ("Apostello Comm — Base Missionnaires"), not in this repository. Operational rules for handling missionary client data (record format, required fields, security handling for missionaries in restricted-access countries, email drafting rules) are defined in the `apostello-onboarding` skill available in this environment — invoke it for any task involving missionary contacts, client records, or missionary-facing content, rather than improvising the process here.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

This repository currently contains only a `README.md` ("ApoComm — everything Apostello Comm"). There is no source code, build system, package manifest, or test suite yet. There are no build/lint/test commands to run because none exist in the repo at this stage — do not invent tooling that isn't there.

When code is added to this repo, update this file with the actual build, lint, and test commands, and document the real architecture as it emerges.

## Domain context

Apostello Comm is a communications agency serving missionaries. Client (missionary) records live in a Google Drive spreadsheet ("Apostello Comm — Base Missionnaires"), not in this repository. Operational rules for handling missionary client data (record format, required fields, security handling for missionaries in restricted-access countries, email drafting rules) are defined in the `apostello-onboarding` skill available in this environment — invoke it for any task involving missionary contacts, client records, or missionary-facing content, rather than improvising the process here.

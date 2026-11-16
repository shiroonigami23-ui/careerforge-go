# CareerForge roadmap

Last updated: 17 November 2026. The PDF copy (`docs/ROADMAP.pdf`) is generated from this file with `python3 scripts/build_roadmap_pdf.py`.

## Where the project stands

CareerForge compares a résumé with a job description, scores the fit, shows which of the job's keywords are covered or missing, and helps rewrite with an assistant. It runs as a Go server with an embedded web UI, as an Electron desktop app for Windows, and fully on-device on Android and iOS.

## Done

### v1.0: platform and redesign (November 2026)

- [x] On-device engine (JavaScript port of the Go pipeline) so the phone apps work with no server
- [x] Android APK, unsigned iOS IPA (sideloading), Windows installer and portable EXE from one release workflow
- [x] Electron desktop shell that runs the Go server privately on 127.0.0.1
- [x] New interface with Lucide icons, light and dark themes, sign-in and account creation, Ctrl+K navigation
- [x] Fit dial, metric bars, matched and missing keyword map, fix-first checklist
- [x] Report download (Markdown) and print to PDF; analysis history with score change
- [x] Passwords stored with PBKDF2-HMAC-SHA256 (legacy hashes upgraded at sign-in)
- [x] Security: database never served over `/files/`, Google ID tokens verified with audience check, Gemini key sent in a header
- [x] Gemini model set by `GEMINI_MODEL` (default `gemini-flash-latest`)
- [x] Test suites: Go unit and HTTP black-box tests, numeric parity between the Go and JS engines, Playwright browser tests; results recorded in `tests/results/`

### v0.x: Go rewrite

- [x] Go API with SQLite and an embedded React UI
- [x] Résumé and job-description pipeline, quality report
- [x] Gemini / Hugging Face routing with built-in answers as fallback

## Next

### v1.1: smarter analysis

- [ ] Synonyms and skill families in keyword matching (for example "Postgres" and "PostgreSQL")
- [ ] Section-level rewrite suggestions with a before/after view
- [ ] ATS formatting checks: tables, columns, images and headers that parsers miss
- [ ] Weighting keywords by where they appear in the job (requirements count more than "nice to have")

### v1.2: everyday use

- [ ] Several résumé versions per person, each tied to target roles
- [ ] Paste a job-posting link and import the description
- [ ] Persist analyses on the server across restarts (today the server keeps reports in memory)
- [ ] Signed Android release builds through repository secrets

### v2.0: preparation tools

- [ ] Interview practice questions generated from the job and the résumé gaps
- [ ] Cover-letter drafts grounded in matched evidence
- [ ] Optional sync between devices, end-to-end encrypted

## Principles

- The person's documents stay on their device unless they choose a server or an AI key.
- Every number in a report can be explained in the Help page.
- Each release ships for Android, iOS, Windows and the web from the same tag.

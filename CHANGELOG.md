# Changelog

All notable changes to **careerforge-go** are listed here. Entries below **Auto-generated** are appended by CI when you push code changes to `main` (see `.github/workflows/changelog.yml`). Documentation-only updates to this file, `README.md`, `Readme.md`, and `README4.md` are not re-logged.

For tagged releases with Android APK + Windows EXE, see [GitHub Releases](https://github.com/shiroonigami23-ui/careerforge-go/releases).

---

## [1.0.0] - 2026-11-17

The first release for Android, iOS, Windows and the web from a single tag.

### Added
- **On-device engine** (`frontend/src/engine`): a JavaScript port of the Go pipeline (extraction, résumé processing, quality report, built-in answers, Gemini with the user's own key) with data in IndexedDB. Android and iOS run without any server.
- **iOS app** (Capacitor) and an **unsigned IPA** in releases, for sideloading with AltStore or Sideloadly.
- **Windows desktop app** (`desktop/`): Electron with an animated splash window; starts the Go server privately on 127.0.0.1. NSIS installer and portable EXE.
- **Release workflow** (`release.yml`): APK, IPA and EXEs built and attached on `v*` tags; `release-test/*` branches run a dry run.
- **CI** (`ci.yml`): gofmt, go vet, go test (race detector), cross-builds, a server smoke test, and all test suites with recorded results.
- **Redesigned interface** with Lucide icons, Bricolage Grotesque and IBM Plex Sans (bundled for offline use), light and dark themes, Ctrl/⌘+K quick navigation and a mobile bottom bar.
- **Fit report**: score dial, metric bars, matched and missing keyword map (click a gap to ask the assistant), fix-first checklist saved per analysis, Markdown download and print/PDF layout.
- **Dashboard**: average fit, change since the previous analysis, recent analyses that reopen in one click, recent uploads.
- **Sign-in dialog** for email/password and Google, and a Settings page (AI key and model, theme, test email, account).
- Animated boot splash (at least 2 s) and new icons/splash screens from the CareerForge emblem (the old "Resume2Job" wordmark is gone).
- Reports include `matched_keywords`; the dashboard includes `recent_sessions`.
- `GEMINI_MODEL` setting (default `gemini-flash-latest`, replacing the retired `gemini-1.5-flash`); `HOST` setting for the listen address.
- Tests: Go unit and HTTP black-box tests, shared numeric fixtures checked by both engines, Vitest UI and engine tests, Playwright browser tests; `node tests/run-all.mjs` records results in `tests/results/`.
- `docs/ROADMAP.pdf`, generated from `docs/ROADMAP.md` by `scripts/build_roadmap_pdf.py`.

### Fixed
- Plain skills lists (no "Label:" prefix) were dropped by the résumé parser, so skills never counted toward keyword coverage (Go and JS).
- Filler words such as *and*, *are*, *need*, *plus* were counted as job keywords; both engines now share one 151-word stop list, guarded by a test.
- The UI showed invented scores (for example a fixed 73% average) when the server was unreachable; those fallbacks are removed.
- The sign-in form was never displayed.
- With the Go server, the report was requested once right after upload, before background processing finished; it is now polled until ready.
- React StrictMode left an internal "mounted" flag false, so report, dashboard and profile updates were dropped in development builds.
- Components defined inside the main component were remounted on every render and could swallow clicks (theme toggle).
- Guests who had analysed résumés got a "Profile not found" dashboard.
- FAQ keywords match whole words only.

### Security
- Passwords are stored with PBKDF2-HMAC-SHA256 (210,000 iterations); older SHA-256 hashes still work and are upgraded at the next sign-in.
- `/files/` serves only `uploaded_files/`; the SQLite database used to be downloadable.
- Google ID tokens are verified with Google's tokeninfo endpoint and the audience must match `GOOGLE_CLIENT_ID`.
- The Gemini key is sent in the `x-goog-api-key` header instead of the URL.
- Database errors are no longer echoed to clients.

## Auto-generated entries

<!-- changelog-bot: entries appended below (newest first within each block) -->

### 2026-03-29 08:01:36 UTC (push `2570ee8e862f306a341e651a5132be5fe435df84`)

- \`2570ee8\` **ShiroOnigami23** (2026-03-29T13:31:25+05:30) — docs: MIT LICENSE, CHANGELOG + auto workflow; explain GitHub contributors


### 2026-03-30 16:47:22 UTC (push `d1ab13f814f34bf26de26428d530f8e0708d96ac`)

- \`d1ab13f\` **ShiroOnigami23** (2026-03-30T22:16:59+05:30) — fix_restore_app_flows_auth_and_local_mode


### 2026-03-30 16:56:39 UTC (push `98f30b6911c7305b3630c685721fbf4c13dfb54e`)

- \`98f30b6\` **ShiroOnigami23** (2026-03-30T22:26:25+05:30) — fix_profile_tab_blank_screen_and_not_found_handling


### 2026-11-13 17:58:11 UTC (push `987bf46ccfee069e723119d0e7fae3b232ea5870`)

- \`987bf46\` **Claude** (2026-11-13T23:28:01+05:30) — docs: overhaul README, add architecture & roadmap docs, banner, dev container


### 2026-11-13 19:01:21 UTC (push `da6b863a555a8e9196f86db83186ac83de960a46`)

- \`da6b863\` **Claude** (2026-11-14T00:31:12+05:30) — ci: fix failing workflows


### 2026-11-16 19:17:48 UTC (push `60cc89e6137e3de951fa45d169c93dcf70314c2e`)

- \`f9679c2\` **Claude** (2026-11-17T00:47:00+05:30) — tests: record CI run (68/68 passed, Go HTTP tests with SQLite)
- \`76ad920\` **Claude** (2026-11-17T00:43:17+05:30) — Docs: new README with downloads, screenshots and walkthrough GIF; CHANGELOG 1.0.0; roadmap with PDF; recorded test run
- \`542c58d\` **Claude** (2026-11-17T00:30:08+05:30) — Redesign CareerForge UI with Lucide icons; fit dial, keyword map, report export, analysis history, dark mode, sign-in
- \`a373b43\` **Claude** (2026-11-17T00:18:52+05:30) — ci: run browser tests on ubuntu-24.04 (Playwright has no Chromium for 26.04)
- \`dc3bcd4\` **Claude** (2026-11-17T00:16:05+05:30) — Tests: Go, engine and browser suites with recorded results; fix dropped skills section, StrictMode UI bug; PBKDF2 passwords
- \`5b91552\` **Claude** (2026-11-16T23:58:05+05:30) — release: allow dry runs from release-test/* branches
- \`0e5cb31\` **Claude** (2026-11-16T23:57:36+05:30) — Add iOS (Capacitor), CareerForge icons, animated boot splash, Electron desktop app, CI and release workflows
- \`7656012\` **Claude** (2026-11-16T23:53:13+05:30) — Use GEMINI_MODEL (default gemini-flash-latest) and x-goog-api-key header; gofmt; device engine on Android
- \`cff5d91\` **Claude** (2026-11-16T23:46:31+05:30) — WIP: on-device engine for APK/IPA, server security fixes


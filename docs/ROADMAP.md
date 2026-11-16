# CareerForge: Roadmap and Technical Guide

How CareerForge works today, where every piece of data lives, how a résumé is analysed, and what comes next.

Aryan Singh Chandel · B.Tech CSE, Rustamji Institute of Technology, Gwalior · Last updated 17 November 2026 · written for v1.0.0

The PDF copy (`docs/ROADMAP.pdf`) is generated from this file with `python3 scripts/build_roadmap_pdf.py`. Edit the Markdown, then rebuild the PDF.

## Contents

1. What CareerForge is
2. The four ways it runs
3. How the app decides between the server and the device
4. Where data is stored
5. How a résumé is analysed
6. How the fit score is calculated
7. How the assistant answers
8. Accounts, profiles and sign-in
9. Direct chat
10. Security model
11. Testing
12. Building and releasing
13. Known limitations
14. Roadmap: v1.1, v1.2, v1.3, v2.0
15. Principles

## 1. What CareerForge is

CareerForge compares one résumé with one job description and answers three questions:

- **How well do they match?** A 0–100 fit score with the four measures behind it.
- **What is missing?** Every important keyword from the job, split into *in your résumé* and *missing from your résumé*.
- **What should I change first?** A checklist of concrete fixes, plus an assistant that can explain gaps, propose a 14-day plan or rewrite a summary.

It is built for students and early-career engineers who apply to many roles and need to tailor a résumé quickly without uploading it to an unknown service.

## 2. The four ways it runs

| Way | What runs where | Where data lives |
|---|---|---|
| **Web app with a server** | The Go program serves the web interface and the API on port 8080 | SQLite database and an `uploaded_files/` folder next to the server |
| **Windows, macOS and Linux desktop apps** | Electron opens a window and starts the same Go server privately on `127.0.0.1` with a random free port | The operating system's per-user app folder (see section 4) |
| **Android and iOS apps** | The web interface runs inside a Capacitor shell with the **on-device engine**; there is no server | IndexedDB inside the app |
| **Web app without a server** (static hosting) | Same on-device engine in the browser | The browser's IndexedDB for that site |

The Go server and the on-device engine implement the **same routes with the same JSON**: `/auth/signup`, `/auth/login`, `/auth/google`, `/upload`, `/analysis/quality`, `/query`, `/dashboard/{id}`, `/profile/{id}`, `/profile/upsert`, `/files/…`. The interface does not know or care which one answers.

The on-device engine (`frontend/src/engine/`) is a JavaScript port of the Go pipeline:

| Go package | JavaScript module | Job |
|---|---|---|
| `internal/extract` | `extract.js` | Read text out of PDF, DOCX, EPUB, TXT, Markdown and images |
| `internal/process` | `process.js` | Clean text, find sections, build chunks |
| `internal/matching` | `llm.js` (`chunkJobDescription`) | Split the job description into chunks |
| `internal/quality` | `quality.js` | Build the quality report |
| `internal/llm`, `internal/faq` | `llm.js` | Gemini answers, built-in answers as fallback |
| `internal/server` | `localApi.js` | The routes, accounts, profiles, files |

## 3. How the app decides between the server and the device

When the interface starts, `frontend/src/engine/api.js` decides once where every request goes:

1. If the build was made with `VITE_ENGINE=device` (the Android and iOS builds use `.env.android` and `.env.ios`), it always uses the on-device engine.
2. Otherwise it requests `GET /dashboard/__probe__` with a 2.5-second timeout.
    - The Go server answers with JSON (`{"error":"Profile not found"}`, status 404). JSON means **a server is present**, so every call goes to it.
    - A static host answers with HTML, and no answer at all means offline. In both cases every call goes to the **on-device engine**.
3. `apiFetch(path, init)` then sends each request to `fetch()` (server) or `localFetch()` (device). File links go through `assetUrl()`, which returns `/files/…` paths on the server and `blob:` URLs on the device.

The header badge shows the result: **On this device** or **Server**.

The desktop apps always use the server, because Electron loads the interface *from* the local Go server.

## 4. Where data is stored

### On the server (web and desktop apps)

Everything lives under the folder given by `CAREERFORGE_ROOT` (default: the current directory; the desktop apps set it to the per-user app folder):

| Path | Contents |
|---|---|
| `data/careerforge.db` | SQLite database (pure-Go driver, no C compiler needed) |
| `uploaded_files/<session-id>/` | The résumé and job description of each analysis, renamed with a random suffix |
| `uploaded_files/profiles/<user-id>/` | Profile photos; a new photo deletes the old one |

Database tables:

| Table | Holds |
|---|---|
| `users` | User ID, email (unique, may be empty for guests), display name, password hash, sign-in provider, Google account ID |
| `user_profiles` | Headline, bio, photo path |
| `sessions` | One row per analysis: session ID, owner, time |
| `uploaded_files` | File metadata: role (résumé or job description), original name, stored path, public URL, size, type |
| `auth_tokens` | SHA-256 hashes of session tokens, owner, expiry (30 days) |

Desktop app folders: Windows `%APPDATA%\CareerForge`, macOS `~/Library/Application Support/CareerForge`, Linux `~/.config/CareerForge`.

**Analysis results are kept in memory.** The extracted chunks of each analysis live in an in-memory store (`internal/store`). Restarting the server clears them; the files and the history rows remain, and the dashboard marks such analyses as *Report not available*. Persisting them is planned for v1.2.

### On the device (Android, iOS, web without a server)

IndexedDB through `idb-keyval`:

| Key | Contents |
|---|---|
| `cf:users` | Accounts with password hashes |
| `cf:profiles` | Headline, bio, photo file ID |
| `cf:sessions` | Each analysis with its résumé and job-description chunks (so reports survive restarts on the device) |
| `cf:files` | File metadata |
| `cf:blob:<file-id>` | The file itself |

`localStorage` keeps small preferences: theme, signed-in user, session token, Gemini key and model, and which checklist items are ticked for each analysis.

Nothing on the device is sent anywhere, except the text sent to Gemini when you add an API key.

## 5. How a résumé is analysed

### Step 1: extract text

| Format | Server (Go) | Device (JavaScript) |
|---|---|---|
| PDF | `ledongthuc/pdf` | `pdfjs-dist` (loaded only when needed) |
| DOCX | Unzip and read `word/document.xml` | `mammoth` |
| EPUB | Unzip and read the XHTML chapters | JSZip and the XHTML chapters |
| TXT, Markdown | Read as text | Read as text |
| Images (JPG, PNG, WebP, GIF, BMP) | Gemini reads the text | Gemini reads the text (needs a key) |

Limits: documents up to 10 MB, images up to 5 MB.

### Step 2: clean the text

- Dashes and pipes become colons, bullets become hyphens, smart quotes become plain quotes, non-ASCII characters are dropped, spaces collapse.
- Lines that look like headings (three words or fewer, containing words such as *skills*, *experience*, *projects*, *education*) are kept as they are.
- Every other line is lower-cased, and commas, semicolons and similar punctuation between letters are removed.

### Step 3: find sections

A line with fewer than three words written in Title Case or ALL CAPS starts a new section. Everything before the first heading is the **contact** section. Section names are mapped to a standard set:

| Standard section | Also recognised as |
|---|---|
| skills | technologies, tools |
| experience | work experience, professional experience |
| projects | case studies |
| leadership | positions, roles, extracurriculars |
| education | academics, qualifications |
| certifications | courses, licenses |

### Step 4: build chunks

| Section | How it is split |
|---|---|
| contact | One chunk; also used to guess the owner's name (email, phone and links are skipped) |
| skills | One chunk per "Label: items" line; a plain list without labels is kept whole |
| experience, projects, leadership | One chunk per bullet (`- `) |
| education, certifications, summary | One chunk, prefixed with the section name |
| anything else | One chunk |

Very short chunks (20 characters or fewer) are dropped, except in skills, where short lines such as "Languages: Go" count.

### Step 5: the job description

With a Gemini key, Gemini splits the job description into chunks (asked to return JSON). Without a key, or if that fails, the whole job description is one chunk. The score does not depend on how the job description is chunked, because keywords are counted over all of its text.

## 6. How the fit score is calculated

```
fit = 0.45 × keyword coverage
    + 0.25 × section coverage
    + 1.2  × min(action verbs, 25)
    + 1.5  × min(quantified results, 20)      (capped at 100, rounded down)
```

**Keywords.** Words of three or more letters (`+`, `#` and `-` allowed, so *c++*, *c#* and *ci-cd* survive) are counted in the job description. 151 filler words are ignored (*and, the, experience, team, required, skills, …*). The 80 most frequent remain; ties are broken alphabetically. Keyword coverage is the share of these job keywords that also appear in the résumé, rounded to the nearest whole per cent. The same calculation exists in Fortran (`native/fortran/coverage.F90`) for the native build.

**Sections.** Distinct sections found, out of six. Six or more is 100.

**Action verbs.** Words from a fixed list: *led, built, implemented, designed, optimized, improved, delivered, managed, developed, automated, migrated, scaled, launched, reduced, increased*.

**Quantified results.** Numbers and percentages anywhere in the résumé.

**Contact checks.** An email address, a phone number (at least ten digits) and the word *linkedin*.

**Bands.** 75 and above is a strong match (green), 50–74 workable (blue), below 50 needs work (amber).

**Missing keywords.** The first 18 job keywords that the résumé lacks, at most eight shown. **Matched keywords:** up to twelve job keywords the résumé has.

**Recommendations** are added when coverage is below 65 %, there are fewer than eight numbers or ten action verbs, LinkedIn, email or phone is missing, or section coverage is below 70.

**Parity.** `tests/fixtures/quality_cases.json` holds hand-computed reports. The Go tests and the JavaScript tests both check every case, and a test compares the two stop-word lists word for word, so the server and the phone can never disagree about a score.

## 7. How the assistant answers

1. The question decides the length: *step by step*, *in detail*, *how can I improve*, *what should I do* (or the **Detailed** switch) ask for a detailed answer; anything else gets a brief one.
2. The prompt sent to the model contains the question, the first four résumé chunks and the first four job-description chunks, with instructions for a brief or a detailed answer.
3. The model is chosen in order:
    - Server: `LLM_PROVIDER` if set, otherwise Gemini (`APP_API_KEY`, model `GEMINI_MODEL`, default `gemini-flash-latest`), then Hugging Face (`HF_TOKEN`, `HF_MODEL_ID`), then built-in answers.
    - Device: Gemini with the key saved in **Settings → AI settings**, then built-in answers.
4. **Built-in answers** (`faq_responses.json`) match whole words in the question to topics such as *qualified*, *missing skills*, *roadmap*, *summary*, *ATS*, and pick one answer per topic in a stable way, so the same question gets the same answer.

The key travels in the `x-goog-api-key` header, never in a URL.

## 8. Accounts, profiles and sign-in

- **Guests** can analyse without an account. A random user ID is created on first use and kept in the browser.
- **Email accounts:** sign-up needs an email and a password of at least six characters. Passwords are stored with PBKDF2-HMAC-SHA256, 210,000 iterations, a random 16-byte salt (`v2$iterations$salt$hash`). Older `v1` hashes (one salted SHA-256) still sign in and are upgraded automatically.
- **Google sign-in** (when `GOOGLE_CLIENT_ID` and `VITE_GOOGLE_CLIENT_ID` are set): the server sends the ID token to Google's tokeninfo endpoint and requires the audience to match. On the device the account stays local, so the token is only decoded for the name and email.
- **Session tokens:** every sign-in returns a random 256-bit token; the server stores only its SHA-256 hash, valid for 30 days. Editing a profile requires the owner's token. A new guest ID claims its profile on first save and receives a token.
- **Profiles:** name, email, headline, bio and photo. Anyone with your user ID can *view* your profile and the files of your analyses (that is the purpose of sharing an ID); only you can *edit* it.
- **Profile completeness** is the share of five fields that are filled in: name, email, headline, bio and photo.

## 9. Direct chat

Direct chat connects two devices with WebRTC. No CareerForge server is involved:

1. Person A selects **Create invite** and sends the code that appears (by any messenger).
2. Person B pastes it and selects **Create reply from invite**, then sends the reply code back.
3. Person A pastes the reply and selects **Connect with reply**.

Messages travel directly between the two devices over an encrypted data channel. A public STUN server helps the devices find each other. Networks that block direct connections (some campus and corporate networks) need a TURN relay, which is planned for v1.2.

## 10. Security model

| Area | Protection | Tested by |
|---|---|---|
| Passwords | PBKDF2-HMAC-SHA256, 210k iterations; same error for unknown email and wrong password | Go: RFC test vector, round trip, malformed hashes, legacy upgrade; JS: same |
| Profile edits | Owner's session token required | Go: no token, forged token, another user's token, guest claim |
| User IDs | Only letters, digits, `-` and `_` (max 64), so an ID can never become a file path | Go: six path-like IDs rejected, nothing written outside the data folder |
| Files | `/files/` serves only `uploaded_files/`; `..` and encoded `..` rejected; the database is never served | Go: eight traversal and exposure attempts |
| Google sign-in | Verified by Google, audience must match | — |
| AI key | Header only, never in URLs or logs | Go: request has no query string |
| Errors | Database and file-system errors are logged, never sent to clients | Go: taken-email case returns a plain message |
| Desktop | Server bound to `127.0.0.1` on a random port; external links open in the system browser | — |
| Uploads | Type and size checked on the client and on the server | Go and JS boundary tests |

## 11. Testing

`node tests/run-all.mjs` runs everything and records the run in `tests/results/<time>/` (`summary.md`, `results.json`) and `tests/results/LATEST.md`.

| Suite | Count (v1.0) | Covers |
|---|---|---|
| Go | 33 test functions (with sub-cases) | Hashing, file limits, profile completeness, parser regressions, report numbers, stop-word parity, HTTP black-box with URL-encoded and multipart forms (accounts, profile ownership, user-ID validation, traversal, uploads, guest history, dashboard and profile file lists, full upload → report → chat) |
| Engine (Vitest) | 30 | Numeric parity with Go, hashing, the on-device API as a black box, interface tests |
| Browser (Playwright) | 11 | Splash, navigation, analysis, checklist, assistant, download, history, quick navigation, mobile layout, accounts, profile, settings, direct chat between two pages |

CI runs the browser suite twice: against the on-device engine (Vite) and against the real Go server.

## 12. Building and releasing

`release.yml` builds everything for a `v*` tag and publishes one GitHub release:

| Job | Output |
|---|---|
| android | `CareerForge-vX.Y.Z.apk` (signed with the release key when repository secrets are set, otherwise the debug key) |
| ios | `CareerForge-vX.Y.Z-unsigned.ipa`: built with `CODE_SIGNING_ALLOWED=NO`, zipped as `Payload/`, installs only through AltStore or Sideloadly |
| windows | Installer and portable EXE (Electron + Go sidecar), plus `careerforge-server-windows-amd64.exe` |
| mac-desktop | Unsigned `.dmg` for Apple Silicon and for Intel, each with its own server build |
| linux-desktop | `.AppImage` and `.deb` |
| servers | Server-only archives for Linux (x64, ARM), macOS (Intel, Apple Silicon) and Windows on ARM |
| publish | `SHA256SUMS.txt`, release notes with install instructions, all files attached |

A push to a `release-test/*` branch runs every build without publishing.

## 13. Known limitations

- The server keeps analysis chunks in memory: after a restart old reports cannot be reopened (history and files remain).
- Keyword matching is literal: *Postgres* and *PostgreSQL* count as different words, and synonyms are not recognised.
- The assistant sees only the first four chunks of each document, so long résumés can leave relevant parts out of the prompt.
- Images need a Gemini key on the device.
- Builds are not code-signed: Windows SmartScreen and macOS Gatekeeper show a warning the first time.
- Direct chat needs a network that allows peer-to-peer connections.

## 14. Roadmap

### v1.1: smarter analysis (target: January 2027)

**Goal:** scores that reflect meaning, not just spelling.

- [ ] **Skill families and synonyms.** A curated map (*Postgres = PostgreSQL*, *JS = JavaScript*, *k8s = Kubernetes*, *CI/CD = continuous integration*) applied in both engines. *Done when:* the parity fixture includes synonym cases and coverage for a résumé that says "PostgreSQL" against a job that says "Postgres" is 100 %.
- [ ] **Weighted keywords.** Keywords from *requirements* count more than *nice to have*. *Done when:* the report shows which missing keywords are required.
- [ ] **Relevant context for the assistant.** Choose the résumé and job chunks that share the most words with the question instead of the first four. *Done when:* a question about a skill listed at the end of a long résumé is answered with that skill in the prompt (unit test on the prompt builder).
- [ ] **ATS formatting checks.** Warn about tables, columns, text in images, headers and footers that applicant-tracking systems often miss (PDF and DOCX).
- [ ] **Section rewrite suggestions** with a before-and-after view.

### v1.2: everyday use (target: March 2027)

**Goal:** CareerForge as the place where every application is prepared.

- [ ] **Persist analyses on the server** (chunks in SQLite) so reports survive restarts.
- [ ] **Résumé versions:** several résumés per person, each linked to target roles, with the score history per version.
- [ ] **Import a job by link:** paste a posting URL and import the description.
- [ ] **Applications tracker:** company, role, date applied, status, the résumé version used and its score.
- [ ] **TURN relay option** for direct chat on restrictive networks.
- [ ] **Signed Android builds** through repository secrets by default.

### v1.3: trust and polish (target: April 2027)

- [ ] Code-signed Windows and macOS builds (when certificates are available).
- [ ] Export and import of all on-device data as one encrypted file.
- [ ] Accessibility audit (screen readers, contrast, keyboard) with automated axe checks in CI.
- [ ] Hindi interface.

### v2.0: preparation tools (target: mid 2027)

- [ ] **Interview practice:** questions generated from the job and the résumé gaps, with model answers built from your own experience bullets.
- [ ] **Cover letters** grounded in matched evidence, never inventing experience.
- [ ] **Optional sync** between devices, end-to-end encrypted.

## 15. Principles

- The person's documents stay on their device unless they choose a server or an AI key.
- Every number in a report can be explained, and the Help page says how.
- The server and the on-device engine give the same answer for the same input, checked by tests.
- Every release ships for Android, iOS, Windows, macOS, Linux and the web from the same tag.
- Security claims are backed by tests.

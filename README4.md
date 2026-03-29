<div align="center">

# CareerForge · Go + React + Android

**Resume / JD intelligence — SQLite API, Gemini & Hugging Face, Capacitor shell.**

[![Go 1.22](https://img.shields.io/badge/Go-1.22-00ADD8?logo=go&logoColor=white)](https://go.dev/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Capacitor](https://img.shields.io/badge/Capacitor-Android-119EFF?logo=capacitor&logoColor=white)](https://capacitorjs.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Changelog](https://img.shields.io/badge/changelog-auto-6f42c1.svg)](CHANGELOG.md)
[![Release](https://img.shields.io/github/v/release/shiroonigami23-ui/careerforge-go?sort=semver&logo=github&label=release)](https://github.com/shiroonigami23-ui/careerforge-go/releases)
[![Android CI](https://img.shields.io/github/actions/workflow/status/shiroonigami23-ui/careerforge-go/android-apk.yml?branch=main&logo=github&label=android%20CI)](https://github.com/shiroonigami23-ui/careerforge-go/actions)
[![Release workflow](https://img.shields.io/github/actions/workflow/status/shiroonigami23-ui/careerforge-go/release-apk.yml?logo=github&label=release%20build)](https://github.com/shiroonigami23-ui/careerforge-go/actions)

<sub>**Tags:** `go` · `golang` · `android` · `capacitor` · `react` · `sqlite` · `career` · `resume` · `gemini` · `vite`</sub>

</div>

---

## Changelog & license

- **History:** [CHANGELOG.md](CHANGELOG.md) — auto-appended on `main` when code changes (not on README-only edits).
- **License:** [MIT](LICENSE) — linked from the main [Readme.md](Readme.md) as well.

---

## What ships in a release

| Asset | Description |
|--------|---------------|
| **`app-release.apk`** | **Signed** release build. Uses your **upload keystore** from repo secrets when configured; otherwise it is signed with the **debug** certificate (installable for testing, not for Play upload). |
| **`careerforge-windows-amd64.exe`** | Single static Windows binary: embedded React UI + same Go server as `go run ./cmd/careerforge`. |

Releases are created automatically when you push a semver tag: `v1.0.0`, `v0.2.3`, …

**CI guarantee:** the publish step runs only after **both** jobs succeed and **fails the whole workflow** if either `careerforge-windows-amd64.exe` or `app-release.apk` is missing — you do not get a GitHub Release with only one asset.

```bash
git tag v0.1.0
git push origin v0.1.0
```

---

## Play-ready signing (optional)

Add these **Repository secrets** (Settings → Secrets and variables → Actions):

| Secret | Meaning |
|--------|---------|
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 release.keystore` (your JKS / PKCS12) |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Key alias |
| `ANDROID_KEY_PASSWORD` | Key password |

If any of these are missing, CI still builds **`app-release.apk`** signed with the **debug** key so the workflow never fails for lack of secrets.

---

## Git & “the token” (read this)

**Do not commit a GitHub PAT into this repo or into any file Cursor can sync.**  
Releases use **`GITHUB_TOKEN`** inside Actions — no personal token required for uploads.

For **your laptop**:

```bash
gh auth login
```

Or one-off: `export GH_TOKEN=...` **only in your shell** for `gh repo create` / `git push` — never paste tokens into chat or commit them.

---

## Desktop EXE (local build)

```powershell
cd frontend; npm ci; npm run build
cd ..
go build -trimpath -ldflags="-s -w" -o careerforge.exe ./cmd/careerforge
```

---

## API keys (runtime)

| Variable | Role |
|----------|------|
| `APP_API_KEY` | Google Gemini |
| `HF_TOKEN` / `HF_MODEL_ID` | Hugging Face (optional) |
| `LLM_PROVIDER` | `auto` / `gemini` / `hf` |

---

## Repo metadata (maintainer checklist)

**Suggested GitHub “About” description:**

> Career intelligence platform: Go backend + React/Vite UI + Android (Capacitor). SQLite, resume/JD pipeline, Gemini/HF routing, embedded FAQ. Ships Windows `.exe` + signed release APK on tags.

**Suggested topics:**  
`go`, `golang`, `android`, `capacitor`, `react`, `vite`, `sqlite`, `career`, `resume`, `gemini`, `machine-learning`

```bash
gh repo edit shiroonigami23-ui/careerforge-go \
  --description "Career intelligence: Go + React + Android (Capacitor), SQLite, Gemini/HF, resume/JD analysis." \
  --add-topic go --add-topic golang --add-topic android --add-topic capacitor \
  --add-topic react --add-topic sqlite --add-topic career --add-topic resume --add-topic gemini
```

---

<p align="center"><i>Native extras: x86-64 assembly in FAQ seed mix · Fortran coverage sample under <code>native/fortran/</code>.</i></p>

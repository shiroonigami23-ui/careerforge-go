# CareerForge (Go)

Career intelligence stack rewritten with **Go** as the primary implementation: SQLite API, resume/JD processing, Gemini/Hugging Face routing, and a React UI (Vite) that is embedded in the desktop binary or packaged for **Android** via Capacitor.

**Native extras in this repo**

- `internal/native/seed/` — x86-64 **plan9 assembly** (`seed_amd64.s`) for deterministic mixing used in FAQ selection (generic Go on other architectures).
- `native/fortran/coverage.F90` — example **Fortran** routine for coverage ratio; default builds use pure Go in `internal/native/coverage/`. Compile the Fortran object yourself if you want to link it with cgo.

## Run (desktop)

```bash
cd frontend && npm install && npm run build
cd .. && go run ./cmd/careerforge
```

Open http://127.0.0.1:8080 — API and static UI share the same origin (`VITE_API_BASE_URL` defaults to empty).

Set `APP_API_KEY` (Gemini) and optionally `HF_TOKEN` / `HF_MODEL_ID` for Hugging Face. FAQ JSON is embedded under `internal/faq/`.

## Android APK

- **CI**: Pushes to `main` build a debug APK artifact (`.github/workflows/android-apk.yml`). Tag `v1.0.0` triggers a GitHub Release with the APK attached (`.github/workflows/release-apk.yml`).
- **Local build**: JDK **21+** is required for the current Android Gradle Plugin. Then:

```bash
cd frontend && npm run build:android && npx cap sync android && cd android && ./gradlew assembleDebug
```

APK path: `frontend/android/app/build/outputs/apk/debug/app-debug.apk`.

The Android bundle calls the API at `http://127.0.0.1:8080` (see `frontend/.env.android`). Run the Go server on the device (see `mobile/` for gomobile integration) or use **adb reverse** while developing:

```bash
adb reverse tcp:8080 tcp:8080
go run ./cmd/careerforge   # on the PC
```

`gomobile bind -target=android ./mobile` can expose `mobile.Start(filesDir)` to load the embedded HTTP stack on-device (advanced).

## Layout

- `cmd/careerforge` — desktop entry, embeds `web/dist`.
- `internal/server` — HTTP API (previous Flask routes).
- `internal/extract`, `internal/process`, `internal/matching` — document pipeline.
- `internal/llm` — provider routing.
- `frontend/` — React app; `android/` — Capacitor Android project.

## Legacy

The original Python/Flask backend is not included here; behavior is intended to match the prior `careerforge` project.

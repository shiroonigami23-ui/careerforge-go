# CareerForge test run — 2026-11-16T19:13:12.213Z

| | |
|---|---|
| Commit | `542c58d` |
| Go | go1.24.7 |
| Node | v22.23.4 |
| Runner | linux |
| Result | **60/68 passed**, 0 failed, 8 skipped |
| Duration | 35.0s |

| Suite | Passed | Failed | Skipped |
|---|---:|---:|---:|
| go | 23 | 0 | 8 |
| engine | 30 | 0 | 0 |
| e2e | 7 | 0 | 0 |

> Skipped Go tests need the SQLite driver (`modernc.org/sqlite`); they always run in CI.

## go

| Status | Test | ms |
|---|---|---:|
| ✅ | internal/faq › TestContainsWordDoesNotMatchInsideWords | 0 |
| ✅ | internal/faq › TestFallbackQualification | 0 |
| ✅ | internal/llm › TestGeminiModelDefault | 0 |
| ✅ | internal/llm › TestGeminiRequestUsesHeaderNotQuery | 0 |
| ✅ | internal/process › TestPlainSkillsListIsKept | 0 |
| ✅ | internal/process › TestLabelledAndShortSkillLines | 0 |
| ✅ | internal/process › TestFindNameSkipsContactDetails | 0 |
| ✅ | internal/quality › TestCoveragePercent | 0 |
| ✅ | internal/quality › TestQualityReportNumbers/strong_resume,_full_keyword_overlap | 0 |
| ✅ | internal/quality › TestQualityReportNumbers/weak_resume,_no_overlap | 0 |
| ✅ | internal/quality › TestQualityReportNumbers/score_is_capped_at_100 | 0 |
| ✅ | internal/quality › TestQualityReportNumbers/half_the_JD_keywords,_three_sections | 0 |
| ✅ | internal/quality › TestQualityReportNumbers/filler_words_in_the_job_description_are_ignored | 0 |
| ✅ | internal/quality › TestQualityReportNumbers | 0 |
| ✅ | internal/quality › TestQualityReportNeedsBothDocuments | 0 |
| ✅ | internal/quality › TestStopWordsMatchJSEngine | 0 |
| ✅ | internal/server › TestPasswordHashV2RoundTrip | 160 |
| ✅ | internal/server › TestPasswordLegacyV1StillVerifies | 0 |
| ✅ | internal/server › TestPasswordMalformedHashes | 0 |
| ✅ | internal/server › TestPBKDF2KnownVector | 0 |
| ✅ | internal/server › TestProfileCompletionNumbers | 0 |
| ✅ | internal/server › TestValidateFileHeaderBoundaries | 0 |
| ✅ | internal/server › TestInferMode | 0 |
| ⏭️ | internal/server › TestHTTPSignupLoginFlow | 0 |
| ⏭️ | internal/server › TestHTTPSignupValidation | 0 |
| ⏭️ | internal/server › TestHTTPLegacyHashUpgradedOnLogin | 0 |
| ⏭️ | internal/server › TestHTTPDatabaseAndSourceNeverServed | 0 |
| ⏭️ | internal/server › TestHTTPDashboardProbeIsJSON404 | 0 |
| ⏭️ | internal/server › TestHTTPQueryValidation | 0 |
| ⏭️ | internal/server › TestHTTPUploadRejectsBadTypes | 0 |
| ⏭️ | internal/server › TestHTTPUploadQualityQueryFlow | 0 |

## engine

| Status | Test | ms |
|---|---|---:|
| ✅ | src/CareerForge.test.jsx › CareerForge UI renders the landing page with the sample report | 101 |
| ✅ | src/CareerForge.test.jsx › CareerForge UI opens the analyzer and enables Analyze fit only with both documents | 256 |
| ✅ | src/CareerForge.test.jsx › CareerForge UI rejects unsupported files with a clear message | 81 |
| ✅ | src/CareerForge.test.jsx › CareerForge UI opens the sign-in dialog and switches to account creation | 100 |
| ✅ | src/CareerForge.test.jsx › CareerForge UI switches between light and dark theme | 53 |
| ✅ | src/smoke.test.jsx › Smoke test shows the landing screen without signing in | 99 |
| ✅ | src/engine/engine.test.js › numeric parity with the Go engine (tests/fixtures/quality_cases.json) coveragePercent(1, 3) = 33 | 1 |
| ✅ | src/engine/engine.test.js › numeric parity with the Go engine (tests/fixtures/quality_cases.json) coveragePercent(2, 3) = 67 | 0 |
| ✅ | src/engine/engine.test.js › numeric parity with the Go engine (tests/fixtures/quality_cases.json) coveragePercent(1, 2) = 50 | 0 |
| ✅ | src/engine/engine.test.js › numeric parity with the Go engine (tests/fixtures/quality_cases.json) coveragePercent(3, 3) = 100 | 0 |
| ✅ | src/engine/engine.test.js › numeric parity with the Go engine (tests/fixtures/quality_cases.json) coveragePercent(0, 4) = 0 | 0 |
| ✅ | src/engine/engine.test.js › numeric parity with the Go engine (tests/fixtures/quality_cases.json) coveragePercent(5, 0) = 0 | 0 |
| ✅ | src/engine/engine.test.js › numeric parity with the Go engine (tests/fixtures/quality_cases.json) coveragePercent(7, 5) = 100 | 0 |
| ✅ | src/engine/engine.test.js › numeric parity with the Go engine (tests/fixtures/quality_cases.json) coveragePercent(-1, 5) = 0 | 0 |
| ✅ | src/engine/engine.test.js › numeric parity with the Go engine (tests/fixtures/quality_cases.json) strong resume, full keyword overlap | 3 |
| ✅ | src/engine/engine.test.js › numeric parity with the Go engine (tests/fixtures/quality_cases.json) weak resume, no overlap | 1 |
| ✅ | src/engine/engine.test.js › numeric parity with the Go engine (tests/fixtures/quality_cases.json) score is capped at 100 | 0 |
| ✅ | src/engine/engine.test.js › numeric parity with the Go engine (tests/fixtures/quality_cases.json) half the JD keywords, three sections | 0 |
| ✅ | src/engine/engine.test.js › numeric parity with the Go engine (tests/fixtures/quality_cases.json) filler words in the job description are ignored | 0 |
| ✅ | src/engine/engine.test.js › numeric parity with the Go engine (tests/fixtures/quality_cases.json) returns null without both documents | 0 |
| ✅ | src/engine/engine.test.js › password hashing (same format as the Go server) v2 PBKDF2 round trip | 119 |
| ✅ | src/engine/engine.test.js › password hashing (same format as the Go server) matches the RFC PBKDF2-HMAC-SHA256 vector (Go uses the same) | 1 |
| ✅ | src/engine/engine.test.js › password hashing (same format as the Go server) rejects malformed hashes | 0 |
| ✅ | src/engine/engine.test.js › localApi black-box (what the UI calls in on-device mode) signup -> login, case-insensitive email, same error for wrong password and unknown user | 117 |
| ✅ | src/engine/engine.test.js › localApi black-box (what the UI calls in on-device mode) signup password length boundary: 5 rejected, 6 accepted | 45 |
| ✅ | src/engine/engine.test.js › localApi black-box (what the UI calls in on-device mode) dashboard probe returns a JSON 404 (used by engine detection) | 1 |
| ✅ | src/engine/engine.test.js › localApi black-box (what the UI calls in on-device mode) upload validation: bad extension and missing JD are rejected | 2 |
| ✅ | src/engine/engine.test.js › localApi black-box (what the UI calls in on-device mode) upload validation: 10 MB document limit | 8 |
| ✅ | src/engine/engine.test.js › localApi black-box (what the UI calls in on-device mode) query validation: 400 without prompt, 404 for unknown session | 1 |
| ✅ | src/engine/engine.test.js › localApi black-box (what the UI calls in on-device mode) end-to-end: upload text resume + JD -> quality report -> chat answer (no API key) | 7 |

## e2e

| Status | Test | ms |
|---|---|---:|
| ✅ | boot splash shows the CareerForge name and emblem for at least 2 s, then goes away | 3254 |
| ✅ | landing page shows the sample report and leads into the workspace | 3486 |
| ✅ | analyze: fit score, keyword map, checklist, assistant | 4035 |
| ✅ | report downloads as Markdown | 3899 |
| ✅ | dashboard lists the analysis and reopens it | 3950 |
| ✅ | quick navigation opens with Ctrl+K | 3631 |
| ✅ | mobile layout uses the bottom navigation | 3431 |

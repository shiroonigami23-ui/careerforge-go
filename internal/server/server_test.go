package server

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

// ---------- unit tests (no database needed) ----------

func TestPasswordHashV2RoundTrip(t *testing.T) {
	h, err := hashPassword("s3cret-pass")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(h, "v2$210000$") {
		t.Fatalf("unexpected format %q", h)
	}
	if !verifyPassword(h, "s3cret-pass") {
		t.Error("correct password rejected")
	}
	if verifyPassword(h, "s3cret-pasS") {
		t.Error("wrong password accepted")
	}
	h2, _ := hashPassword("s3cret-pass")
	if h == h2 {
		t.Error("two hashes of the same password must differ (random salt)")
	}
	if needsRehash(h) {
		t.Error("fresh hash should not need rehash")
	}
}

func TestPasswordLegacyV1StillVerifies(t *testing.T) {
	// v1$salt$sha256(salt||password) for salt=00..0f, password "hunter22"
	legacy := "v1$000102030405060708090a0b0c0d0e0f$" + sha256HexForTest([]byte{0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15}, "hunter22")
	if !verifyPassword(legacy, "hunter22") {
		t.Error("legacy v1 hash rejected")
	}
	if verifyPassword(legacy, "hunter23") {
		t.Error("legacy v1 wrong password accepted")
	}
	if !needsRehash(legacy) {
		t.Error("v1 hash should be upgraded")
	}
}

func TestPasswordMalformedHashes(t *testing.T) {
	for _, h := range []string{"", "v1$", "v2$abc$00$00", "v2$0$00$00", "v2$99999999999$00$00", "v3$1$2$3", "plaintext", "v2$1000$zz$00"} {
		if verifyPassword(h, "x") {
			t.Errorf("malformed hash %q accepted", h)
		}
	}
}

// RFC 7914 §11 / RFC 6070-style vector for PBKDF2-HMAC-SHA256.
func TestPBKDF2KnownVector(t *testing.T) {
	got := pbkdf2SHA256([]byte("passwd"), []byte("salt"), 1, 64)
	want := "55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc49ca9cccf179b645991664b39d77ef317c71b845b1e30bd509112041d3a19783"
	if hexString(got) != want {
		t.Errorf("pbkdf2 mismatch:\n got %s\nwant %s", hexString(got), want)
	}
}

func TestProfileCompletionNumbers(t *testing.T) {
	cases := []struct {
		fields [5]string
		want   int
	}{
		{[5]string{"", "", "", "", ""}, 0},
		{[5]string{"A", "", "", "", ""}, 20},
		{[5]string{"A", "a@b.c", "", "", ""}, 40},
		{[5]string{"A", "a@b.c", "h", "", ""}, 60},
		{[5]string{"A", "a@b.c", "h", "b", ""}, 80},
		{[5]string{"A", "a@b.c", "h", "b", "/img.png"}, 100},
	}
	for _, c := range cases {
		if got := profileCompletion(c.fields[0], c.fields[1], c.fields[2], c.fields[3], c.fields[4]); got != c.want {
			t.Errorf("profileCompletion(%v) = %d, want %d", c.fields, got, c.want)
		}
	}
}

func TestValidateFileHeaderBoundaries(t *testing.T) {
	const MB = 1024 * 1024
	cases := []struct {
		name  string
		size  int64
		image bool
		ok    bool
	}{
		{"cv.pdf", 10 * MB, false, true},    // exactly at the document limit
		{"cv.pdf", 10*MB + 1, false, false}, // one byte over
		{"cv.docx", 1, false, true},
		{"cv.exe", 1, false, false},       // unsupported type
		{"cv", 1, false, false},           // no extension
		{"me.png", 5 * MB, true, true},    // image at the limit
		{"me.png", 5*MB + 1, true, false}, // image one byte over
		{"cv.pdf", 1, true, false},        // document where an image is required
		{"CV.PDF", 1, false, true},        // extension is case-insensitive
	}
	for _, c := range cases {
		ok, msg := validateFileHeader(&multipart.FileHeader{Filename: c.name, Size: c.size}, c.image)
		if ok != c.ok {
			t.Errorf("%s size=%d image=%v: ok=%v (%s), want %v", c.name, c.size, c.image, ok, msg, c.ok)
		}
	}
}

func TestInferMode(t *testing.T) {
	if inferMode("Explain step by step how to improve") != "detailed" {
		t.Error("expected detailed")
	}
	if inferMode("Top skills?") != "brief" {
		t.Error("expected brief")
	}
}

// ---------- black-box HTTP tests (need the SQLite driver; always run in CI) ----------

func newTestServer(t *testing.T) (*httptest.Server, string) {
	t.Helper()
	if !slices.Contains(sql.Drivers(), "sqlite") {
		if os.Getenv("CI") != "" {
			t.Fatal("sqlite driver missing in CI: these tests must run there")
		}
		t.Skip("sqlite driver not linked in this build")
	}
	root := t.TempDir()
	static := fstest.MapFS{"index.html": {Data: []byte(`<!doctype html><div id="root"></div>`)}}
	srv, err := New(Config{RootDir: root, StaticFS: static})
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(func() { ts.Close(); _ = srv.Close() })
	return ts, root
}

func postForm(t *testing.T, ts *httptest.Server, path string, v url.Values) (int, map[string]any, string) {
	t.Helper()
	res, err := http.PostForm(ts.URL+path, v)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	var m map[string]any
	_ = json.Unmarshal(b, &m)
	return res.StatusCode, m, string(b)
}

func get(t *testing.T, ts *httptest.Server, path string) (int, string) {
	t.Helper()
	res, err := http.Get(ts.URL + path)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res.StatusCode, string(b)
}

func TestHTTPSignupLoginFlow(t *testing.T) {
	ts, _ := newTestServer(t)
	_, m, raw := postForm(t, ts, "/auth/signup", url.Values{"email": {"Aryan@Example.com"}, "password": {"hunter22"}, "display_name": {"Aryan"}})
	if m["user_id"] == nil {
		t.Fatalf("signup: %s", raw)
	}
	_, m, raw = postForm(t, ts, "/auth/signup", url.Values{"email": {"aryan@example.com"}, "password": {"hunter22"}})
	if m["error"] == nil {
		t.Errorf("duplicate signup should fail: %s", raw)
	}
	_, m, raw = postForm(t, ts, "/auth/login", url.Values{"email": {" ARYAN@example.com "}, "password": {"hunter22"}})
	if m["user_id"] == nil {
		t.Errorf("login (case-insensitive email): %s", raw)
	}
	_, m, _ = postForm(t, ts, "/auth/login", url.Values{"email": {"aryan@example.com"}, "password": {"wrong"}})
	_, m2, _ := postForm(t, ts, "/auth/login", url.Values{"email": {"nobody@example.com"}, "password": {"wrong"}})
	if m["error"] == nil || m["error"] != m2["error"] {
		t.Errorf("wrong password and unknown user must give the same error: %v vs %v", m["error"], m2["error"])
	}
}

func TestHTTPSignupValidation(t *testing.T) {
	ts, _ := newTestServer(t)
	for _, v := range []url.Values{
		{"email": {""}, "password": {"hunter22"}},
		{"email": {"a@b.co"}, "password": {"12345"}}, // 5 chars: one below the minimum
	} {
		if _, m, raw := postForm(t, ts, "/auth/signup", v); m["error"] == nil {
			t.Errorf("expected error for %v: %s", v, raw)
		}
	}
	if _, m, raw := postForm(t, ts, "/auth/signup", url.Values{"email": {"min@b.co"}, "password": {"123456"}}); m["user_id"] == nil {
		t.Errorf("6-char password should be accepted: %s", raw)
	}
}

func TestHTTPLegacyHashUpgradedOnLogin(t *testing.T) {
	ts, root := newTestServer(t)
	_, m, _ := postForm(t, ts, "/auth/signup", url.Values{"email": {"old@x.io"}, "password": {"hunter22"}})
	uid, _ := m["user_id"].(string)
	db, err := sql.Open("sqlite", filepath.Join(root, "data", "careerforge.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	legacy := "v1$000102030405060708090a0b0c0d0e0f$" + sha256HexForTest([]byte{0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15}, "hunter22")
	if _, err := db.Exec(`UPDATE users SET password_hash = ? WHERE user_id = ?`, legacy, uid); err != nil {
		t.Fatal(err)
	}
	if _, m, raw := postForm(t, ts, "/auth/login", url.Values{"email": {"old@x.io"}, "password": {"hunter22"}}); m["user_id"] == nil {
		t.Fatalf("legacy login failed: %s", raw)
	}
	var now string
	_ = db.QueryRow(`SELECT password_hash FROM users WHERE user_id = ?`, uid).Scan(&now)
	if !strings.HasPrefix(now, "v2$") {
		t.Errorf("hash not upgraded: %q", now)
	}
}

func TestHTTPDatabaseAndSourceNeverServed(t *testing.T) {
	ts, root := newTestServer(t)
	_ = os.MkdirAll(filepath.Join(root, "uploaded_files", "s1"), 0o755)
	_ = os.WriteFile(filepath.Join(root, "uploaded_files", "s1", "ok.txt"), []byte("public"), 0o644)
	_ = os.WriteFile(filepath.Join(root, "secret.env"), []byte("APP_API_KEY=xyz"), 0o644)

	if code, body := get(t, ts, "/files/uploaded_files/s1/ok.txt"); code != 200 || body != "public" {
		t.Errorf("uploaded file should be served, got %d %q", code, body)
	}
	for _, p := range []string{
		"/files/data/careerforge.db",
		"/files/uploaded_files/../data/careerforge.db",
		"/files/uploaded_files/%2e%2e/data/careerforge.db",
		"/files/uploaded_files/..%2fdata/careerforge.db",
		"/files/secret.env",
		"/files/uploaded_files/../secret.env",
		"/files/",
		"/files/uploaded_files/s1",
	} {
		req, _ := http.NewRequest(http.MethodGet, ts.URL+"/", nil)
		req.URL.Opaque = p // send the path exactly as written (no client-side cleaning)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode == 200 && (bytes.Contains(b, []byte("SQLite format")) || bytes.Contains(b, []byte("APP_API_KEY"))) {
			t.Errorf("%s leaked a private file", p)
		}
	}
}

func TestHTTPDashboardProbeIsJSON404(t *testing.T) {
	ts, _ := newTestServer(t)
	code, body := get(t, ts, "/dashboard/__probe__")
	if code != 404 || !strings.Contains(body, "Profile not found") {
		t.Errorf("got %d %s", code, body)
	}
}

func TestHTTPQueryValidation(t *testing.T) {
	ts, _ := newTestServer(t)
	if code, _, _ := postForm(t, ts, "/query", url.Values{"session_id": {"s"}}); code != 400 {
		t.Errorf("missing prompt: %d", code)
	}
	if code, _, _ := postForm(t, ts, "/query", url.Values{"session_id": {"nope"}, "prompt": {"hi"}}); code != 404 {
		t.Errorf("unknown session: %d", code)
	}
}

func multipartUpload(t *testing.T, ts *httptest.Server, sid string, files map[string][2]string) map[string]any {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	_ = w.WriteField("session_id", sid)
	for field, f := range files {
		fw, _ := w.CreateFormFile(field, f[0])
		_, _ = fw.Write([]byte(f[1]))
	}
	_ = w.Close()
	res, err := http.Post(ts.URL+"/upload", w.FormDataContentType(), &buf)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var m map[string]any
	_ = json.NewDecoder(res.Body).Decode(&m)
	return m
}

func TestHTTPUploadRejectsBadTypes(t *testing.T) {
	ts, _ := newTestServer(t)
	m := multipartUpload(t, ts, "s-bad", map[string][2]string{"resume": {"cv.exe", "MZ"}, "jd": {"jd.txt", "Go"}})
	if m["error"] == nil {
		t.Errorf("exe should be rejected: %v", m)
	}
	m = multipartUpload(t, ts, "s-missing", map[string][2]string{"resume": {"cv.txt", "x"}})
	if m["error"] == nil {
		t.Errorf("missing jd should be rejected: %v", m)
	}
}

// End-to-end: upload a text resume + JD, wait for processing, check the quality report and chat answer.
func TestHTTPUploadQualityQueryFlow(t *testing.T) {
	t.Setenv("APP_API_KEY", "")
	t.Setenv("HF_TOKEN", "")
	t.Setenv("LLM_PROVIDER", "")
	ts, _ := newTestServer(t)
	resume := "Aryan Singh\naryan@example.com\n+91 98765 43210\nlinkedin.com/in/aryan\n\nSKILLS\nPython Docker Kubernetes Go\n\nEXPERIENCE\nLed a migration and built 3 services, improved latency by 40%\n\nEDUCATION\nB.Tech CSE 2027\n"
	m := multipartUpload(t, ts, "s-flow", map[string][2]string{"resume": {"cv.txt", resume}, "jd": {"jd.txt", "We need Python, Docker and Kubernetes."}})
	if m["error"] != nil {
		t.Fatalf("upload: %v", m)
	}
	ru, _ := m["resume_url"].(string)
	if code, body := get(t, ts, ru); code != 200 || !strings.Contains(body, "Kubernetes") {
		t.Errorf("uploaded resume not retrievable at %s: %d", ru, code)
	}
	var rep map[string]any
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		_, rep, _ = postForm(t, ts, "/analysis/quality", url.Values{"session_id": {"s-flow"}})
		if rep["quality_score"] != nil {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if rep["quality_score"] == nil {
		t.Fatalf("quality report never became ready: %v", rep)
	}
	q := rep["quality_score"].(float64)
	if q <= 0 || q > 100 {
		t.Errorf("quality_score out of range: %v", q)
	}
	if cov := rep["keyword_coverage"].(float64); cov < 50 {
		t.Errorf("keyword_coverage too low for a matching resume: %v", cov)
	}
	code, _, answer := postForm(t, ts, "/query", url.Values{"session_id": {"s-flow"}, "prompt": {"How can I improve my resume?"}})
	if code != 200 || strings.TrimSpace(answer) == "" {
		t.Errorf("query: %d %q", code, answer)
	}
}

func upsertProfile(t *testing.T, ts *httptest.Server, userID, name, token string) (int, map[string]any) {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	_ = w.WriteField("user_id", userID)
	_ = w.WriteField("display_name", name)
	_ = w.Close()
	req, _ := http.NewRequest(http.MethodPost, ts.URL+"/profile/upsert", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var m map[string]any
	_ = json.NewDecoder(res.Body).Decode(&m)
	return res.StatusCode, m
}

// Security: only the owner can edit a profile, even though user IDs are shared for lookups.
func TestHTTPProfileEditRequiresOwnerToken(t *testing.T) {
	ts, _ := newTestServer(t)
	_, acct, _ := postForm(t, ts, "/auth/signup", url.Values{"email": {"owner@x.io"}, "password": {"hunter22"}, "display_name": {"Owner"}})
	uid, _ := acct["user_id"].(string)
	tok, _ := acct["token"].(string)
	if uid == "" || len(tok) != 64 {
		t.Fatalf("signup must return user_id and a token: %v", acct)
	}
	if code, _ := upsertProfile(t, ts, uid, "Hijacked", ""); code != http.StatusForbidden {
		t.Errorf("edit without token: %d, want 403", code)
	}
	if code, _ := upsertProfile(t, ts, uid, "Hijacked", strings.Repeat("a", 64)); code != http.StatusForbidden {
		t.Errorf("edit with a forged token: %d, want 403", code)
	}
	if code, m := upsertProfile(t, ts, uid, "Owner Renamed", tok); code != 200 || m["display_name"] != "Owner Renamed" {
		t.Errorf("owner edit: %d %v", code, m)
	}
	_, other, _ := postForm(t, ts, "/auth/signup", url.Values{"email": {"other@x.io"}, "password": {"hunter22"}})
	if code, _ := upsertProfile(t, ts, uid, "Hijacked", other["token"].(string)); code != http.StatusForbidden {
		t.Errorf("another user's token: %d, want 403", code)
	}
	_, login, _ := postForm(t, ts, "/auth/login", url.Values{"email": {"owner@x.io"}, "password": {"hunter22"}})
	if code, _ := upsertProfile(t, ts, uid, "Owner Again", login["token"].(string)); code != 200 {
		t.Errorf("token from login should work: %d", code)
	}
}

func TestHTTPGuestClaimsProfileOnce(t *testing.T) {
	ts, _ := newTestServer(t)
	code, first := upsertProfile(t, ts, "guest-123", "Guest", "")
	tok, _ := first["token"].(string)
	if code != 200 || tok == "" {
		t.Fatalf("first save should create the profile and return a token: %d %v", code, first)
	}
	if code, _ := upsertProfile(t, ts, "guest-123", "Someone else", ""); code != http.StatusForbidden {
		t.Errorf("second save without token: %d, want 403", code)
	}
	if code, _ := upsertProfile(t, ts, "guest-123", "Guest Renamed", tok); code != 200 {
		t.Errorf("save with the claimed token: %d", code)
	}
}

package server

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/shiroonigami23-ui/careerforge-go/internal/db"
	"github.com/shiroonigami23-ui/careerforge-go/internal/extract"
	"github.com/shiroonigami23-ui/careerforge-go/internal/faq"
	"github.com/shiroonigami23-ui/careerforge-go/internal/llm"
	"github.com/shiroonigami23-ui/careerforge-go/internal/matching"
	"github.com/shiroonigami23-ui/careerforge-go/internal/process"
	"github.com/shiroonigami23-ui/careerforge-go/internal/quality"
	"github.com/shiroonigami23-ui/careerforge-go/internal/store"
)

const appName = "CareerForge"

var docExt = map[string]struct{}{
	"pdf": {}, "docx": {}, "txt": {}, "md": {}, "epub": {},
}
var imgExt = map[string]struct{}{
	"jpg": {}, "jpeg": {}, "png": {}, "webp": {}, "gif": {}, "bmp": {},
}

// Config drives paths and optional static UI.
type Config struct {
	RootDir    string
	StaticFS   fs.FS // e.g. web/dist embedded from main; nil = API only
	FAQPath    string
	DBPath     string
	HTTPClient *http.Client
}

// Server is the HTTP API and static file handler.
type Server struct {
	cfg        Config
	db         *sql.DB
	vs         *store.VectorStore
	httpClient *http.Client
	mu         sync.Mutex
}

func New(cfg Config) (*Server, error) {
	if cfg.HTTPClient == nil {
		cfg.HTTPClient = http.DefaultClient
	}
	if cfg.DBPath == "" {
		cfg.DBPath = filepath.Join(cfg.RootDir, "data", "careerforge.db")
	}
	d, err := db.Open(cfg.DBPath)
	if err != nil {
		return nil, err
	}
	if cfg.FAQPath != "" {
		if err := faq.Load(cfg.FAQPath); err != nil {
			log.Println("faq load:", err)
		}
	}
	return &Server{cfg: cfg, db: d, vs: store.New(), httpClient: cfg.HTTPClient}, nil
}

func (s *Server) Close() error { return s.db.Close() }

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /auth/signup", s.handleAuthSignup)
	mux.HandleFunc("POST /auth/login", s.handleAuthLogin)
	mux.HandleFunc("POST /auth/google", s.handleAuthGoogle)
	mux.HandleFunc("GET /files/", s.handleFiles)
	mux.HandleFunc("POST /notifications/test-email", s.handleTestEmail)
	mux.HandleFunc("GET /dashboard/", s.handleDashboard)
	mux.HandleFunc("POST /analysis/quality", s.handleQuality)
	mux.HandleFunc("POST /profile/upsert", s.handleProfileUpsert)
	mux.HandleFunc("GET /profile/", s.handleProfileGet)
	mux.HandleFunc("POST /upload", s.handleUpload)
	mux.HandleFunc("POST /query", s.handleQuery)

	if s.cfg.StaticFS != nil {
		mux.Handle("GET /assets/", http.FileServer(http.FS(s.cfg.StaticFS)))
		fileRoot := http.FileServer(http.FS(s.cfg.StaticFS))
		mux.Handle("GET /", spaFallback(s.cfg.StaticFS, fileRoot))
	} else {
		mux.HandleFunc("GET /", s.handleHealthOnly)
	}
	return cors(mux)
}

func (s *Server) handleAuthSignup(w http.ResponseWriter, r *http.Request) {
	if !parseForm(w, r) {
		return
	}
	email := strings.ToLower(strings.TrimSpace(r.FormValue("email")))
	password := r.FormValue("password")
	display := strings.TrimSpace(r.FormValue("display_name"))
	if display == "" {
		display = "User"
	}
	if email == "" {
		writeJSON(w, map[string]any{"error": "email is required"})
		return
	}
	if len(password) < 6 {
		writeJSON(w, map[string]any{"error": "password must be at least 6 characters"})
		return
	}

	var exists string
	err := s.db.QueryRow(`SELECT user_id FROM users WHERE email = ?`, email).Scan(&exists)
	if err == nil {
		writeJSON(w, map[string]any{"error": "email already registered"})
		return
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		serverError(w, err)
		return
	}

	userID := "u_" + randomHex(12)
	passwordHash, err := hashPassword(password)
	if err != nil {
		serverError(w, err)
		return
	}
	_, err = s.db.Exec(`
INSERT INTO users (user_id, email, display_name, password_hash, auth_provider)
VALUES (?, ?, ?, ?, 'email')`, userID, email, display, passwordHash)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, map[string]any{
		"user_id":       userID,
		"token":         s.issueToken(userID),
		"email":         email,
		"display_name":  display,
		"auth_provider": "email",
	})
}

func (s *Server) handleAuthLogin(w http.ResponseWriter, r *http.Request) {
	if !parseForm(w, r) {
		return
	}
	email := strings.ToLower(strings.TrimSpace(r.FormValue("email")))
	password := r.FormValue("password")
	if email == "" || password == "" {
		writeJSON(w, map[string]any{"error": "email and password are required"})
		return
	}
	var userID, display, hash, provider sql.NullString
	err := s.db.QueryRow(`
SELECT user_id, display_name, password_hash, auth_provider
FROM users WHERE email = ?`, email).Scan(&userID, &display, &hash, &provider)
	if err != nil {
		writeJSON(w, map[string]any{"error": "invalid email or password"})
		return
	}
	if !hash.Valid || hash.String == "" || !verifyPassword(hash.String, password) {
		writeJSON(w, map[string]any{"error": "invalid email or password"})
		return
	}
	if needsRehash(hash.String) {
		if upgraded, err := hashPassword(password); err == nil {
			_, _ = s.db.Exec(`UPDATE users SET password_hash = ? WHERE user_id = ?`, upgraded, userID.String)
		}
	}
	writeJSON(w, map[string]any{
		"user_id":       userID.String,
		"token":         s.issueToken(userID.String),
		"email":         email,
		"display_name":  display.String,
		"auth_provider": provider.String,
	})
}

func (s *Server) handleAuthGoogle(w http.ResponseWriter, r *http.Request) {
	if !parseForm(w, r) {
		return
	}
	cred := strings.TrimSpace(r.FormValue("credential"))
	if cred == "" {
		writeJSON(w, map[string]any{"error": "credential is required"})
		return
	}
	sub, email, name, err := s.verifyGoogleCredential(cred)
	if err != nil {
		writeJSON(w, map[string]any{"error": "invalid google credential"})
		return
	}
	if name == "" {
		name = "Google User"
	}

	var userID, display sql.NullString
	find := s.db.QueryRow(`SELECT user_id, display_name FROM users WHERE google_sub = ?`, sub)
	err = find.Scan(&userID, &display)
	if err == nil {
		if email != "" {
			_, _ = s.db.Exec(`UPDATE users SET email = COALESCE(?, email), updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`, email, userID.String)
		}
		writeJSON(w, map[string]any{
			"user_id":       userID.String,
			"token":         s.issueToken(userID.String),
			"email":         email,
			"display_name":  firstNonEmpty(display.String, name),
			"auth_provider": "google",
		})
		return
	}
	if !errors.Is(err, sql.ErrNoRows) {
		serverError(w, err)
		return
	}

	if email != "" {
		row := s.db.QueryRow(`SELECT user_id, display_name FROM users WHERE email = ?`, email)
		if scanErr := row.Scan(&userID, &display); scanErr == nil {
			_, _ = s.db.Exec(`
UPDATE users SET google_sub = ?, auth_provider = 'google', display_name = COALESCE(NULLIF(display_name,''), ?), updated_at = CURRENT_TIMESTAMP
WHERE user_id = ?`, sub, name, userID.String)
			writeJSON(w, map[string]any{
				"user_id":       userID.String,
				"token":         s.issueToken(userID.String),
				"email":         email,
				"display_name":  firstNonEmpty(display.String, name),
				"auth_provider": "google",
			})
			return
		}
	}

	userID = sql.NullString{String: "u_" + randomHex(12), Valid: true}
	_, err = s.db.Exec(`
INSERT INTO users (user_id, email, display_name, auth_provider, google_sub)
VALUES (?, ?, ?, 'google', ?)`, userID.String, nullIfEmpty(email), name, sub)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, map[string]any{
		"user_id":       userID.String,
		"token":         s.issueToken(userID.String),
		"email":         email,
		"display_name":  name,
		"auth_provider": "google",
	})
}

func (s *Server) handleHealthOnly(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	writeJSON(w, map[string]string{"status": "ok", "service": appName + " backend"})
}

func spaFallback(dist fs.FS, file http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" || r.URL.Path == "" {
			serveIndex(w, dist)
			return
		}
		if _, err := fs.Stat(dist, strings.TrimPrefix(r.URL.Path, "/")); err == nil {
			file.ServeHTTP(w, r)
			return
		}
		serveIndex(w, dist)
	})
}

func serveIndex(w http.ResponseWriter, dist fs.FS) {
	b, err := fs.ReadFile(dist, "index.html")
	if err != nil {
		http.Error(w, "frontend not built", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(b)
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func (s *Server) handleFiles(w http.ResponseWriter, r *http.Request) {
	// Only uploaded files are public. Everything else under RootDir (including the
	// SQLite database in data/) must never be served.
	rel := strings.TrimPrefix(r.URL.Path, "/files/")
	rel = filepath.ToSlash(filepath.Clean("/" + rel))[1:]
	if rel == "" || strings.Contains(rel, "..") || !strings.HasPrefix(rel, "uploaded_files/") {
		http.NotFound(w, r)
		return
	}
	uploads := filepath.Clean(filepath.Join(s.cfg.RootDir, "uploaded_files"))
	full := filepath.Clean(filepath.Join(s.cfg.RootDir, filepath.FromSlash(rel)))
	if !strings.HasPrefix(full, uploads+string(os.PathSeparator)) {
		http.NotFound(w, r)
		return
	}
	info, err := os.Stat(full)
	if err != nil || info.IsDir() {
		http.NotFound(w, r)
		return
	}
	http.ServeFile(w, r, full)
}

func (s *Server) handleTestEmail(w http.ResponseWriter, r *http.Request) {
	if !parseForm(w, r) {
		return
	}
	to := strings.TrimSpace(r.FormValue("to_email"))
	if to == "" {
		writeJSON(w, map[string]any{"error": "to_email is required"})
		return
	}
	if strings.ToLower(os.Getenv("EMAIL_NOTIFICATIONS_ENABLED")) != "true" {
		writeJSON(w, map[string]any{"ok": false, "detail": "Email notifications disabled"})
		return
	}
	writeJSON(w, map[string]any{"ok": false, "detail": "SES not configured in this build"})
}

func (s *Server) handleDashboard(w http.ResponseWriter, r *http.Request) {
	userID := strings.TrimPrefix(r.URL.Path, "/dashboard/")
	userID = strings.TrimSuffix(userID, "/")
	if !validUserID(userID) {
		w.WriteHeader(http.StatusNotFound)
		writeJSON(w, map[string]any{"error": "Profile not found"})
		return
	}
	row := s.db.QueryRow(`
SELECT u.user_id, u.email, u.display_name, p.headline, p.bio, p.profile_image_url,
       COALESCE(s.sessions_count, 0), COALESCE(f.files_count, 0)
FROM users u
LEFT JOIN user_profiles p ON p.user_id = u.user_id
LEFT JOIN (SELECT user_id, COUNT(*) AS sessions_count FROM sessions GROUP BY user_id) s ON s.user_id = u.user_id
LEFT JOIN (SELECT owner_user_id, COUNT(*) AS files_count FROM uploaded_files GROUP BY owner_user_id) f ON f.owner_user_id = u.user_id
WHERE u.user_id = ?`, userID)
	var uid, email, display, headline, bio, img sql.NullString
	var sc, fc int
	if err := row.Scan(&uid, &email, &display, &headline, &bio, &img, &sc, &fc); err != nil {
		// Guests (no account) still get a dashboard once they have analysed something.
		_ = s.db.QueryRow(`SELECT COUNT(*) FROM sessions WHERE user_id = ?`, userID).Scan(&sc)
		if sc == 0 {
			w.WriteHeader(http.StatusNotFound)
			writeJSON(w, map[string]any{"error": "Profile not found"})
			return
		}
		_ = s.db.QueryRow(`SELECT COUNT(*) FROM uploaded_files WHERE owner_user_id = ?`, userID).Scan(&fc)
	}
	rows, err := s.db.Query(`
SELECT uf.file_id, uf.file_role, uf.original_name, uf.public_url, uf.extension, uf.size_bytes, uf.created_at
FROM uploaded_files uf
INNER JOIN sessions s ON s.session_id = uf.session_id
WHERE s.user_id = ?
ORDER BY uf.file_id DESC LIMIT 8`, userID)
	if err != nil {
		http.Error(w, "database error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	var uploads []map[string]any
	for rows.Next() {
		var fid int
		var role, oname, purl, ext, created string
		var sz int
		_ = rows.Scan(&fid, &role, &oname, &purl, &ext, &sz, &created)
		uploads = append(uploads, map[string]any{
			"file_id": fid, "file_role": role, "original_name": oname, "public_url": purl,
			"extension": ext, "size_bytes": sz, "created_at": created,
		})
	}
	srows, err := s.db.Query(`SELECT session_id, created_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 15`, userID)
	if err != nil {
		http.Error(w, "database error", http.StatusInternalServerError)
		return
	}
	type sessionRow struct{ id, created string }
	var sids []sessionRow
	for srows.Next() {
		var sr sessionRow
		_ = srows.Scan(&sr.id, &sr.created)
		sids = append(sids, sr)
	}
	_ = srows.Close()
	analyzed := 0
	var qvals []int
	recent := []map[string]any{}
	for _, sr := range sids {
		entry := map[string]any{"session_id": sr.id, "created_at": sr.created, "quality_score": nil, "keyword_coverage": nil}
		if rep := quality.Build(sr.id, s.vs); rep != nil {
			analyzed++
			qvals = append(qvals, rep.QualityScore)
			entry["quality_score"] = rep.QualityScore
			entry["keyword_coverage"] = rep.KeywordCoverage
		}
		recent = append(recent, entry)
	}
	avgQ := 0
	if len(qvals) > 0 {
		t := 0
		for _, x := range qvals {
			t += x
		}
		avgQ = t / len(qvals)
	}
	pc := profileCompletion(display.String, email.String, headline.String, bio.String, img.String)
	writeJSON(w, map[string]any{
		"app_name": appName, "profile_completion": pc, "sessions_count": sc, "files_count": fc,
		"analyzed_sessions": analyzed, "average_quality_score": avgQ, "recent_uploads": uploads,
		"recent_sessions": recent,
	})
}

func profileCompletion(displayName, email, headline, bio, img string) int {
	fields := []bool{
		displayName != "", email != "", headline != "", bio != "", img != "",
	}
	n := 0
	for _, f := range fields {
		if f {
			n++
		}
	}
	return (n * 100) / len(fields)
}

func (s *Server) handleQuality(w http.ResponseWriter, r *http.Request) {
	if !parseForm(w, r) {
		return
	}
	sid := strings.TrimSpace(r.FormValue("session_id"))
	if sid == "" {
		writeJSON(w, map[string]any{"error": "session_id is required"})
		return
	}
	rep := quality.Build(sid, s.vs)
	if rep == nil {
		writeJSON(w, map[string]any{"error": "Quality report not ready for this session"})
		return
	}
	writeJSON(w, rep)
}

func (s *Server) handleProfileUpsert(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(12 << 20); err != nil {
		http.Error(w, "bad form", http.StatusBadRequest)
		return
	}
	userID := strings.TrimSpace(r.FormValue("user_id"))
	if userID == "" {
		writeJSON(w, map[string]any{"error": "user_id is required"})
		return
	}
	if !validUserID(userID) {
		w.WriteHeader(http.StatusBadRequest)
		writeJSON(w, map[string]any{"error": "user_id may contain only letters, digits, '-' and '_'"})
		return
	}
	// Only the owner may edit a profile. An existing account needs its session token;
	// a brand-new guest ID is claimed by this request and receives a token to use from now on.
	var exists int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM users WHERE user_id = ?`, userID).Scan(&exists)
	claimToken := ""
	if exists > 0 {
		if !s.tokenOwns(bearerToken(r), userID) && !s.legacyGuestClaim(userID, &claimToken) {
			w.WriteHeader(http.StatusForbidden)
			writeJSON(w, map[string]any{"error": "Sign in again to edit this profile."})
			return
		}
	} else {
		claimToken = s.issueToken(userID)
	}
	email := strings.TrimSpace(r.FormValue("email"))
	display := strings.TrimSpace(r.FormValue("display_name"))
	if display == "" {
		display = "User"
	}
	headline := strings.TrimSpace(r.FormValue("headline"))
	bio := strings.TrimSpace(r.FormValue("bio"))

	var prevURL sql.NullString
	_ = s.db.QueryRow(`SELECT profile_image_url FROM user_profiles WHERE user_id = ?`, userID).Scan(&prevURL)

	var profileURL string
	var haveNew bool
	if f, hdr, err := r.FormFile("profile_image"); err == nil {
		defer f.Close()
		if ok, msg := validateFileHeader(hdr, true); !ok {
			writeJSON(w, map[string]any{"error": msg})
			return
		}
		ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(hdr.Filename), "."))
		if _, ok := imgExt[ext]; !ok {
			writeJSON(w, map[string]any{"error": "Profile image must be an image file."})
			return
		}
		dir := filepath.Join(s.cfg.RootDir, "uploaded_files", "profiles", userID)
		_ = os.MkdirAll(dir, 0o755)
		name := fmt.Sprintf("profile_%s%s", randomHex(8), fileExtDot(ext))
		path := filepath.Join(dir, name)
		out, err := os.Create(path)
		if err != nil {
			log.Println("profile image:", err)
			http.Error(w, "could not store the image", http.StatusInternalServerError)
			return
		}
		_, _ = io.Copy(out, f)
		_ = out.Close()
		profileURL = s.publicURL(path)
		haveNew = true
		if prevURL.Valid && prevURL.String != "" {
			old := strings.TrimPrefix(prevURL.String, "/files/")
			_ = os.Remove(filepath.Join(s.cfg.RootDir, filepath.FromSlash(old)))
		}
	} else if prevURL.Valid {
		profileURL = prevURL.String
	}

	var emailArg interface{}
	if email != "" {
		emailArg = email
	}
	_, err := s.db.Exec(`
INSERT INTO users (user_id, email, display_name) VALUES (?, ?, ?)
ON CONFLICT(user_id) DO UPDATE SET email=COALESCE(excluded.email, users.email), display_name=excluded.display_name, updated_at=CURRENT_TIMESTAMP`,
		userID, emailArg, display)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			w.WriteHeader(http.StatusConflict)
			writeJSON(w, map[string]any{"error": "That email address belongs to another account."})
			return
		}
		log.Println("profile upsert:", err)
		http.Error(w, "database error", http.StatusInternalServerError)
		return
	}

	var imgInsert interface{}
	if haveNew {
		imgInsert = profileURL
	}

	_, err = s.db.Exec(`
INSERT INTO user_profiles (user_id, headline, bio, profile_image_url) VALUES (?, ?, ?, ?)
ON CONFLICT(user_id) DO UPDATE SET
  headline=excluded.headline,
  bio=excluded.bio,
  profile_image_url=COALESCE(excluded.profile_image_url, user_profiles.profile_image_url),
  updated_at=CURRENT_TIMESTAMP`,
		userID, headline, bio, imgInsert)
	if err != nil {
		log.Println("profile upsert:", err)
		http.Error(w, "database error", http.StatusInternalServerError)
		return
	}

	var outImg interface{}
	if haveNew {
		outImg = profileURL
	} else if prevURL.Valid {
		outImg = prevURL.String
	}
	out := map[string]any{
		"user_id": userID, "email": email, "display_name": display,
		"headline": headline, "bio": bio, "profile_image_url": outImg,
	}
	if claimToken != "" {
		out["token"] = claimToken
	}
	writeJSON(w, out)
}

func (s *Server) handleProfileGet(w http.ResponseWriter, r *http.Request) {
	userID := strings.TrimPrefix(r.URL.Path, "/profile/")
	userID = strings.TrimSuffix(userID, "/")
	if !validUserID(userID) {
		w.WriteHeader(http.StatusNotFound)
		writeJSON(w, map[string]any{"error": "Profile not found"})
		return
	}
	row := s.db.QueryRow(`SELECT u.user_id, u.email, u.display_name, p.headline, p.bio, p.profile_image_url
FROM users u LEFT JOIN user_profiles p ON p.user_id = u.user_id WHERE u.user_id = ?`, userID)
	var uid, email, dn, hl, bio, img sql.NullString
	if err := row.Scan(&uid, &email, &dn, &hl, &bio, &img); err != nil {
		w.WriteHeader(http.StatusNotFound)
		writeJSON(w, map[string]any{"error": "Profile not found"})
		return
	}
	rows, err := s.db.Query(`
SELECT uf.file_id, uf.file_role, uf.original_name, uf.public_url, uf.extension, uf.size_bytes, uf.created_at
FROM uploaded_files uf INNER JOIN sessions s ON s.session_id = uf.session_id
WHERE s.user_id = ? ORDER BY uf.file_id DESC`, userID)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	var files []map[string]any
	for rows.Next() {
		var fid int
		var role, oname, purl, ext, created string
		var sz int
		_ = rows.Scan(&fid, &role, &oname, &purl, &ext, &sz, &created)
		files = append(files, map[string]any{
			"file_id": fid, "file_role": role, "original_name": oname, "public_url": purl,
			"extension": ext, "size_bytes": sz, "created_at": created,
		})
	}
	writeJSON(w, map[string]any{
		"profile": map[string]any{
			"user_id": uid.String, "email": email.String, "display_name": dn.String,
			"headline": hl.String, "bio": bio.String, "profile_image_url": img.String,
		},
		"files": files,
	})
}

func (s *Server) handleUpload(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		http.Error(w, "bad form", http.StatusBadRequest)
		return
	}
	sid := strings.TrimSpace(r.FormValue("session_id"))
	uid := strings.TrimSpace(r.FormValue("user_id"))
	if uid != "" && !validUserID(uid) {
		w.WriteHeader(http.StatusBadRequest)
		writeJSON(w, map[string]any{"error": "user_id may contain only letters, digits, '-' and '_'"})
		return
	}
	if sid == "" {
		writeJSON(w, map[string]any{"error": "Missing session_id or files"})
		return
	}
	rf, hdrR, err := r.FormFile("resume")
	if err != nil {
		writeJSON(w, map[string]any{"error": "Missing session_id or files"})
		return
	}
	defer rf.Close()
	jf, hdrJ, err := r.FormFile("jd")
	if err != nil {
		writeJSON(w, map[string]any{"error": "Missing session_id or files"})
		return
	}
	defer jf.Close()

	for _, pair := range []struct {
		h *multipart.FileHeader
		n string
	}{{hdrR, "resume"}, {hdrJ, "jd"}} {
		if ok, msg := validateFileHeader(pair.h, false); !ok {
			writeJSON(w, map[string]any{"error": pair.n + ": " + msg})
			return
		}
		ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(pair.h.Filename), "."))
		_, okDoc := docExt[ext]
		_, okImg := imgExt[ext]
		if !okDoc && !okImg {
			writeJSON(w, map[string]any{"error": fmt.Sprintf("%s: extension '%s' is not supported for analysis", pair.n, ext)})
			return
		}
	}

	var u interface{}
	if uid != "" {
		u = uid
	}
	if uid != "" {
		// Guests analyse before they ever save a profile: give them a user row so their
		// analyses and files are recorded (sessions.user_id references users).
		if _, err := s.db.Exec(`INSERT OR IGNORE INTO users (user_id, display_name, auth_provider) VALUES (?, 'Guest', 'guest')`, uid); err != nil {
			log.Println("upload guest user:", err)
		}
	}
	if _, err := s.db.Exec(`INSERT OR IGNORE INTO sessions (session_id, user_id) VALUES (?, ?)`, sid, u); err != nil {
		log.Println("upload session:", err)
	}

	rpath, err := saveUploaded(s.cfg.RootDir, hdrR, sid, "resume")
	if err != nil {
		serverError(w, err)
		return
	}
	jpath, err := saveUploaded(s.cfg.RootDir, hdrJ, sid, "jd")
	if err != nil {
		serverError(w, err)
		return
	}
	if err := s.registerUploaded(sid, uid, rpath, "resume", hdrR); err != nil {
		log.Println("register upload:", err)
	}
	if err := s.registerUploaded(sid, uid, jpath, "jd", hdrJ); err != nil {
		log.Println("register upload:", err)
	}

	apiKey := os.Getenv("APP_API_KEY")
	go s.processUpload(rpath, jpath, sid, apiKey)

	writeJSON(w, map[string]any{
		"message":    "Upload received. Processing started.",
		"resume_url": s.publicURL(rpath),
		"jd_url":     s.publicURL(jpath),
	})
}

func (s *Server) processUpload(rpath, jpath, sid, apiKey string) {
	defer func() {
		if r := recover(); r != nil {
			log.Println("processUpload panic:", r)
		}
	}()
	text, err := extract.TextFromFile(rpath, apiKey, s.httpClient)
	if err != nil {
		log.Println("resume extract:", err)
		return
	}
	process.CleanText(text, sid, s.vs)
	if err := matching.ProcessJD(jpath, sid, apiKey, s.httpClient, s.vs); err != nil {
		log.Println("jd process:", err)
	}
}

func inferMode(prompt string) string {
	pl := strings.ToLower(prompt)
	kws := []string{"guarantee", "step by step", "in detail", "what should i do", "how can i improve", "explain deeply", "detailed"}
	for _, k := range kws {
		if strings.Contains(pl, k) {
			return "detailed"
		}
	}
	return "brief"
}

func (s *Server) handleQuery(w http.ResponseWriter, r *http.Request) {
	if !parseForm(w, r) {
		return
	}
	sid := strings.TrimSpace(r.FormValue("session_id"))
	prompt := strings.TrimSpace(r.FormValue("prompt"))
	if sid == "" || prompt == "" {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte("Missing session_id or prompt"))
		return
	}
	sv, ok := s.vs.Get(sid)
	if !ok || sv == nil || len(sv.Resume) == 0 || len(sv.JD) == 0 {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte("Session not found"))
		return
	}
	var resumeChunks, jdChunks []string
	for i := 0; i < len(sv.Resume) && i < 4; i++ {
		resumeChunks = append(resumeChunks, sv.Resume[i].Meta.ChunkText)
	}
	for i := 0; i < len(sv.JD) && i < 4; i++ {
		jdChunks = append(jdChunks, sv.JD[i].Meta.ChunkText)
	}
	mode := inferMode(prompt)
	var llmPrompt string
	if mode == "brief" {
		llmPrompt = briefPrompt(prompt, resumeChunks, jdChunks)
	} else {
		llmPrompt = detailedPrompt(prompt, resumeChunks, jdChunks)
	}
	out := llm.Generate(prompt, llmPrompt, s.httpClient)
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write([]byte(out))
}

func briefPrompt(prompt string, resume, jd []string) string {
	return fmt.Sprintf(`You are a professional career advisor.

Answer the question clearly and concisely.

RULES:
- Keep the response SHORT (max 120 words)
- Use bullet points only
- No long explanations
- No repetition
- Be direct and practical

STRUCTURE:
## Verdict
(one line)

## Key Strengths
- max 3 bullet points

## Key Gaps
- max 2 bullet points

User Question:
%s

Resume:
%s

Job Description:
%s`, prompt, strings.Join(resume, "\n"), strings.Join(jd, "\n"))
}

func detailedPrompt(prompt string, resume, jd []string) string {
	return fmt.Sprintf(`You are a professional career advisor.

Give a detailed, structured analysis.

RULES:
- Use clear Markdown headings
- Use bullet points
- Explain briefly under each point
- Avoid unnecessary repetition

STRUCTURE:
## Overall Verdict
(short paragraph)

## Strengths & Matches
- bullets with explanation

## Gaps / Areas to Improve
- bullets with explanation

## What to Do to Strengthen Qualification
- actionable steps

User Question:
%s

Resume:
%s

Job Description:
%s`, prompt, strings.Join(resume, "\n"), strings.Join(jd, "\n"))
}

func (s *Server) registerUploaded(sessionID, ownerID, storagePath, role string, fh *multipart.FileHeader) error {
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(fh.Filename), "."))
	size := fh.Size
	mt := fh.Header.Get("Content-Type")
	if mt == "" {
		mt = mime.TypeByExtension(filepath.Ext(fh.Filename))
	}
	var owner interface{}
	if ownerID != "" {
		owner = ownerID
	}
	_, err := s.db.Exec(`
INSERT INTO uploaded_files (session_id, owner_user_id, file_role, original_name, storage_path, public_url, mime_type, extension, size_bytes)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(storage_path) DO UPDATE SET
 session_id=excluded.session_id, owner_user_id=excluded.owner_user_id, file_role=excluded.file_role,
 original_name=excluded.original_name, public_url=excluded.public_url, mime_type=excluded.mime_type,
 extension=excluded.extension, size_bytes=excluded.size_bytes, created_at=CURRENT_TIMESTAMP`,
		sessionID, owner, role, fh.Filename, storagePath, s.publicURL(storagePath), mt, ext, size)
	return err
}

func saveUploaded(root string, fh *multipart.FileHeader, sessionID, role string) (string, error) {
	dir := filepath.Join(root, "uploaded_files", sessionID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	ext := filepath.Ext(fh.Filename)
	path := filepath.Join(dir, role+ext)
	out, err := os.Create(path)
	if err != nil {
		return "", err
	}
	defer out.Close()
	src, err := fh.Open()
	if err != nil {
		return "", err
	}
	defer src.Close()
	_, err = io.Copy(out, src)
	return path, err
}

func validateFileHeader(h *multipart.FileHeader, image bool) (bool, string) {
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(h.Filename), "."))
	max := int64(10 * 1024 * 1024)
	if _, ok := imgExt[ext]; ok {
		max = 5 * 1024 * 1024
		if !image {
			return true, ""
		}
	} else if _, ok := docExt[ext]; ok {
		if image {
			return false, "Unsupported file type."
		}
	} else {
		return false, "Unsupported file type."
	}
	if h.Size > max {
		if max == 5*1024*1024 {
			return false, "Image file too large. Max is 5MB."
		}
		return false, "Document file too large. Max is 10MB."
	}
	return true, ""
}

func (s *Server) publicURL(absStorage string) string {
	rel, err := filepath.Rel(s.cfg.RootDir, absStorage)
	if err != nil {
		rel = filepath.Base(absStorage)
	}
	return "/files/" + filepath.ToSlash(rel)
}

func fileExtDot(ext string) string {
	if ext == "" {
		return ""
	}
	return "." + ext
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// Passwords are stored as "v2$<iterations>$<salt hex>$<PBKDF2-HMAC-SHA256 hex>".
// "v1$salt$sha256" hashes from older versions still verify and are upgraded on the next login.
const pbkdf2Iterations = 210000

func hashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	dk := pbkdf2SHA256([]byte(password), salt, pbkdf2Iterations, 32)
	return fmt.Sprintf("v2$%d$%s$%s", pbkdf2Iterations, hex.EncodeToString(salt), hex.EncodeToString(dk)), nil
}

func verifyPassword(stored, password string) bool {
	parts := strings.Split(stored, "$")
	switch {
	case len(parts) == 4 && parts[0] == "v2":
		iter, err := strconv.Atoi(parts[1])
		if err != nil || iter < 1 || iter > 10_000_000 {
			return false
		}
		salt, err1 := hex.DecodeString(parts[2])
		want, err2 := hex.DecodeString(parts[3])
		if err1 != nil || err2 != nil || len(want) == 0 {
			return false
		}
		return subtle.ConstantTimeCompare(want, pbkdf2SHA256([]byte(password), salt, iter, len(want))) == 1
	case len(parts) == 3 && parts[0] == "v1":
		salt, err1 := hex.DecodeString(parts[1])
		want, err2 := hex.DecodeString(parts[2])
		if err1 != nil || err2 != nil {
			return false
		}
		got := sha256.Sum256(append(salt, []byte(password)...))
		return subtle.ConstantTimeCompare(want, got[:]) == 1
	}
	return false
}

// needsRehash reports whether a stored hash should be upgraded to the current scheme.
func needsRehash(stored string) bool {
	return !strings.HasPrefix(stored, fmt.Sprintf("v2$%d$", pbkdf2Iterations))
}

// pbkdf2SHA256 implements PBKDF2 (RFC 8018) with HMAC-SHA256 using only the standard library.
func pbkdf2SHA256(password, salt []byte, iter, keyLen int) []byte {
	prf := hmac.New(sha256.New, password)
	hLen := prf.Size()
	blocks := (keyLen + hLen - 1) / hLen
	out := make([]byte, 0, blocks*hLen)
	buf := make([]byte, 4)
	u := make([]byte, hLen)
	t := make([]byte, hLen)
	for block := 1; block <= blocks; block++ {
		prf.Reset()
		prf.Write(salt)
		binary.BigEndian.PutUint32(buf, uint32(block))
		prf.Write(buf)
		u = prf.Sum(u[:0])
		copy(t, u)
		for n := 2; n <= iter; n++ {
			prf.Reset()
			prf.Write(u)
			u = prf.Sum(u[:0])
			for i := range t {
				t[i] ^= u[i]
			}
		}
		out = append(out, t...)
	}
	return out[:keyLen]
}

// verifyGoogleCredential checks a Google ID token with Google's tokeninfo endpoint:
// the signature, expiry and issuer are verified by Google, and the audience must match
// GOOGLE_CLIENT_ID when it is configured. A token is never trusted just by decoding it.
func (s *Server) verifyGoogleCredential(credential string) (sub, email, name string, err error) {
	if strings.Count(credential, ".") != 2 {
		return "", "", "", errors.New("invalid jwt")
	}
	req, err := http.NewRequest(http.MethodGet, "https://oauth2.googleapis.com/tokeninfo?id_token="+credential, nil)
	if err != nil {
		return "", "", "", err
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return "", "", "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", "", "", fmt.Errorf("google rejected the token: %s", resp.Status)
	}
	var claims struct {
		Aud   string `json:"aud"`
		Iss   string `json:"iss"`
		Sub   string `json:"sub"`
		Email string `json:"email"`
		Name  string `json:"name"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&claims); err != nil {
		return "", "", "", err
	}
	if claims.Iss != "accounts.google.com" && claims.Iss != "https://accounts.google.com" {
		return "", "", "", errors.New("unexpected issuer")
	}
	if clientID := strings.TrimSpace(os.Getenv("GOOGLE_CLIENT_ID")); clientID != "" && claims.Aud != clientID {
		return "", "", "", errors.New("token was issued for a different application")
	}
	if claims.Sub == "" {
		return "", "", "", errors.New("missing sub")
	}
	return claims.Sub, strings.ToLower(strings.TrimSpace(claims.Email)), strings.TrimSpace(claims.Name), nil
}

func nullIfEmpty(v string) any {
	v = strings.TrimSpace(v)
	if v == "" {
		return nil
	}
	return v
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

// ---- session tokens (profile edits) ----

const tokenLifetime = 30 * 24 * time.Hour

func tokenHash(t string) string {
	sum := sha256.Sum256([]byte(t))
	return hex.EncodeToString(sum[:])
}

// issueToken creates a random session token for userID; only its SHA-256 is stored.
func (s *Server) issueToken(userID string) string {
	t := randomHex(32)
	_, err := s.db.Exec(`INSERT INTO auth_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)`,
		tokenHash(t), userID, time.Now().UTC().Add(tokenLifetime).Format(time.RFC3339))
	if err != nil {
		log.Println("issue token:", err)
		return ""
	}
	return t
}

func (s *Server) tokenOwns(token, userID string) bool {
	if token == "" || len(token) > 200 {
		return false
	}
	var owner, expires string
	if err := s.db.QueryRow(`SELECT user_id, expires_at FROM auth_tokens WHERE token_hash = ?`, tokenHash(token)).Scan(&owner, &expires); err != nil {
		return false
	}
	exp, err := time.Parse(time.RFC3339, expires)
	if err != nil || time.Now().UTC().After(exp) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(owner), []byte(userID)) == 1
}

func bearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, "Bearer ") {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
}

// legacyGuestClaim lets a guest profile created before tokens existed (no password, no Google
// account, no token ever issued) claim a token once. After that the normal check applies.
func (s *Server) legacyGuestClaim(userID string, claimToken *string) bool {
	var hasPassword, hasGoogle, tokens int
	_ = s.db.QueryRow(`SELECT COUNT(password_hash), COUNT(google_sub) FROM users WHERE user_id = ?`, userID).Scan(&hasPassword, &hasGoogle)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM auth_tokens WHERE user_id = ?`, userID).Scan(&tokens)
	if hasPassword > 0 || hasGoogle > 0 || tokens > 0 {
		return false
	}
	*claimToken = s.issueToken(userID)
	return *claimToken != ""
}

// parseForm reads URL-encoded and multipart bodies alike. Browsers send FormData as
// multipart/form-data, which r.ParseForm alone does not read (and once r.Form is set,
// r.FormValue no longer parses the multipart body either).
func parseForm(w http.ResponseWriter, r *http.Request) bool {
	if err := r.ParseMultipartForm(1 << 20); err != nil && !errors.Is(err, http.ErrNotMultipart) {
		http.Error(w, "bad form", http.StatusBadRequest)
		return false
	}
	return true
}

// validUserID accepts the IDs CareerForge creates (u_<hex>, UUIDs) and nothing that could
// change a file path or a URL: letters, digits, '-' and '_' only, at most 64 characters.
var userIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

func validUserID(id string) bool { return userIDPattern.MatchString(id) }

// serverError logs the real error and gives the client a generic message (no SQL or paths).
func serverError(w http.ResponseWriter, err error) {
	log.Println("server error:", err)
	http.Error(w, "internal server error", http.StatusInternalServerError)
}

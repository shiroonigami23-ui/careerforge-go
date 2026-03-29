package server

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

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
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
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
	rel := strings.TrimPrefix(r.URL.Path, "/files/")
	rel = filepath.ToSlash(filepath.Clean(rel))
	if strings.Contains(rel, "..") {
		http.NotFound(w, r)
		return
	}
	full := filepath.Join(s.cfg.RootDir, rel)
	base := filepath.Clean(s.cfg.RootDir)
	if !strings.HasPrefix(filepath.Clean(full), base) {
		http.NotFound(w, r)
		return
	}
	if _, err := os.Stat(full); err != nil {
		http.NotFound(w, r)
		return
	}
	http.ServeFile(w, r, full)
}

func (s *Server) handleTestEmail(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad form", http.StatusBadRequest)
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
		writeJSON(w, map[string]any{"error": "Profile not found"})
		return
	}
	rows, err := s.db.Query(`
SELECT file_id, file_role, original_name, public_url, extension, size_bytes, created_at
FROM uploaded_files uf
INNER JOIN sessions s ON s.session_id = uf.session_id
WHERE s.user_id = ?
ORDER BY file_id DESC LIMIT 8`, userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
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
	srows, _ := s.db.Query(`SELECT session_id FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 15`, userID)
	var sids []string
	for srows.Next() {
		var sid string
		_ = srows.Scan(&sid)
		sids = append(sids, sid)
	}
	_ = srows.Close()
	analyzed := 0
	var qvals []int
	for _, sid := range sids {
		if rep := quality.Build(sid, s.vs); rep != nil {
			analyzed++
			qvals = append(qvals, rep.QualityScore)
		}
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
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad form", http.StatusBadRequest)
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
			http.Error(w, err.Error(), http.StatusInternalServerError)
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
ON CONFLICT(user_id) DO UPDATE SET email=excluded.email, display_name=excluded.display_name, updated_at=CURRENT_TIMESTAMP`,
		userID, emailArg, display)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
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
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	var outImg interface{}
	if haveNew {
		outImg = profileURL
	} else if prevURL.Valid {
		outImg = prevURL.String
	}
	writeJSON(w, map[string]any{
		"user_id": userID, "email": email, "display_name": display,
		"headline": headline, "bio": bio, "profile_image_url": outImg,
	})
}

func (s *Server) handleProfileGet(w http.ResponseWriter, r *http.Request) {
	userID := strings.TrimPrefix(r.URL.Path, "/profile/")
	userID = strings.TrimSuffix(userID, "/")
	row := s.db.QueryRow(`SELECT u.user_id, u.email, u.display_name, p.headline, p.bio, p.profile_image_url
FROM users u LEFT JOIN user_profiles p ON p.user_id = u.user_id WHERE u.user_id = ?`, userID)
	var uid, email, dn, hl, bio, img sql.NullString
	if err := row.Scan(&uid, &email, &dn, &hl, &bio, &img); err != nil {
		writeJSON(w, map[string]any{"error": "Profile not found"})
		return
	}
	rows, err := s.db.Query(`
SELECT file_id, file_role, original_name, public_url, extension, size_bytes, created_at
FROM uploaded_files uf INNER JOIN sessions s ON s.session_id = uf.session_id
WHERE s.user_id = ? ORDER BY file_id DESC`, userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
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
	_, _ = s.db.Exec(`INSERT OR IGNORE INTO sessions (session_id, user_id) VALUES (?, ?)`, sid, u)

	rpath, err := saveUploaded(s.cfg.RootDir, hdrR, sid, "resume")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jpath, err := saveUploaded(s.cfg.RootDir, hdrJ, sid, "jd")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	_ = s.registerUploaded(sid, uid, rpath, "resume", hdrR)
	_ = s.registerUploaded(sid, uid, jpath, "jd", hdrJ)

	apiKey := os.Getenv("APP_API_KEY")
	go s.processUpload(rpath, jpath, sid, apiKey)

	writeJSON(w, map[string]any{
		"message":    "Upload received. Processing started.",
		"resume_url":   s.publicURL(rpath),
		"jd_url":       s.publicURL(jpath),
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
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad form", http.StatusBadRequest)
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

package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

func Open(dbPath string) (*sql.DB, error) {
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		return nil, err
	}
	d, err := sql.Open("sqlite", dbPath+"?_pragma=foreign_keys(1)")
	if err != nil {
		return nil, err
	}
	if err := migrate(d); err != nil {
		_ = d.Close()
		return nil, err
	}
	return d, nil
}

func migrate(d *sql.DB) error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS users (
			user_id TEXT PRIMARY KEY,
			email TEXT UNIQUE,
			display_name TEXT NOT NULL,
			password_hash TEXT,
			auth_provider TEXT NOT NULL DEFAULT 'guest',
			google_sub TEXT UNIQUE,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS user_profiles (
			user_id TEXT PRIMARY KEY,
			headline TEXT,
			bio TEXT,
			profile_image_url TEXT,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS sessions (
			session_id TEXT PRIMARY KEY,
			user_id TEXT,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE SET NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
		`CREATE TABLE IF NOT EXISTS uploaded_files (
			file_id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id TEXT NOT NULL,
			owner_user_id TEXT,
			file_role TEXT NOT NULL,
			original_name TEXT NOT NULL,
			storage_path TEXT NOT NULL UNIQUE,
			public_url TEXT NOT NULL,
			mime_type TEXT,
			extension TEXT NOT NULL,
			size_bytes INTEGER NOT NULL,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY(session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
			FOREIGN KEY(owner_user_id) REFERENCES users(user_id) ON DELETE SET NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_uploaded_files_session ON uploaded_files(session_id)`,
		`CREATE INDEX IF NOT EXISTS idx_uploaded_files_owner ON uploaded_files(owner_user_id)`,
	}
	for _, s := range stmts {
		if _, err := d.Exec(s); err != nil {
			return fmt.Errorf("migrate: %w", err)
		}
	}
	_ = ensureColumn(d, "users", "password_hash", "TEXT")
	_ = ensureColumn(d, "users", "auth_provider", "TEXT NOT NULL DEFAULT 'guest'")
	_ = ensureColumn(d, "users", "google_sub", "TEXT")
	return nil
}

func ensureColumn(d *sql.DB, table, col, def string) error {
	rows, err := d.Query("PRAGMA table_info(" + table + ")")
	if err != nil {
		return err
	}
	defer rows.Close()
	var have bool
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull, pk int
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return err
		}
		if name == col {
			have = true
			break
		}
	}
	if !have {
		_, err = d.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", table, col, def))
	}
	return err
}

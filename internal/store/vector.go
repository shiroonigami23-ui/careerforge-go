package store

import "sync"

// ChunkMeta mirrors Python vector_store chunk meta.
type ChunkMeta struct {
	ChunkText   string `json:"chunk_text"`
	Section     string `json:"section"`
	ResumeOwner string `json:"resume_owner,omitempty"`
}

type VectorEntry struct {
	Meta ChunkMeta `json:"meta"`
}

// SessionVectors holds resume and JD chunks per session.
type SessionVectors struct {
	Resume []VectorEntry
	JD     []VectorEntry
}

type VectorStore struct {
	mu sync.RWMutex
	m  map[string]*SessionVectors
}

func New() *VectorStore {
	return &VectorStore{m: make(map[string]*SessionVectors)}
}

func (v *VectorStore) ensure(sessionID string) *SessionVectors {
	if v.m[sessionID] == nil {
		v.m[sessionID] = &SessionVectors{}
	}
	return v.m[sessionID]
}

func (v *VectorStore) EmbedChunks(sessionID, chunkType string, chunks []ChunkMeta) {
	v.mu.Lock()
	defer v.mu.Unlock()
	s := v.ensure(sessionID)
	for _, ch := range chunks {
		if ch.ChunkText == "" {
			continue
		}
		entry := VectorEntry{Meta: ch}
		if chunkType == "jd" {
			s.JD = append(s.JD, entry)
		} else {
			s.Resume = append(s.Resume, entry)
		}
	}
}

func (v *VectorStore) EmbedStringChunks(sessionID, chunkType string, lines []string) {
	var metas []ChunkMeta
	for _, t := range lines {
		t = trim(t)
		if t == "" {
			continue
		}
		metas = append(metas, ChunkMeta{ChunkText: t, Section: "unknown"})
	}
	v.EmbedChunks(sessionID, chunkType, metas)
}

func (v *VectorStore) Get(sessionID string) (*SessionVectors, bool) {
	v.mu.RLock()
	defer v.mu.RUnlock()
	s, ok := v.m[sessionID]
	return s, ok
}

func trim(s string) string {
	// minimal trim; processing package does more
	for len(s) > 0 && (s[0] == ' ' || s[0] == '\n' || s[0] == '\r' || s[0] == '\t') {
		s = s[1:]
	}
	for len(s) > 0 && (s[len(s)-1] == ' ' || s[len(s)-1] == '\n' || s[len(s)-1] == '\r' || s[len(s)-1] == '\t') {
		s = s[:len(s)-1]
	}
	return s
}

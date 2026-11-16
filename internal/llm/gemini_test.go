package llm

import (
	"strings"
	"testing"
)

func TestGeminiModelDefault(t *testing.T) {
	t.Setenv("GEMINI_MODEL", "")
	if got := GeminiModel(); got != DefaultGeminiModel {
		t.Fatalf("got %q", got)
	}
}

func TestGeminiRequestUsesHeaderNotQuery(t *testing.T) {
	t.Setenv("GEMINI_MODEL", "gemini-2.5-flash")
	req, err := NewGeminiRequest([]byte(`{}`), "secret")
	if err != nil {
		t.Fatal(err)
	}
	if req.URL.RawQuery != "" || strings.Contains(req.URL.String(), "secret") {
		t.Fatalf("key leaked into URL: %s", req.URL)
	}
	if req.Header.Get("x-goog-api-key") != "secret" {
		t.Fatal("missing x-goog-api-key header")
	}
	if !strings.Contains(req.URL.Path, "/models/gemini-2.5-flash:generateContent") {
		t.Fatalf("wrong path %s", req.URL.Path)
	}
}

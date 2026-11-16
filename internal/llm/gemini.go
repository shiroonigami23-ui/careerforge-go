package llm

import (
	"bytes"
	"net/http"
	"net/url"
	"os"
	"strings"
)

// DefaultGeminiModel is used when GEMINI_MODEL is not set.
// gemini-1.5-flash was shut down in September 2025; the "latest" alias
// tracks Google's current Flash model.
const DefaultGeminiModel = "gemini-flash-latest"

// GeminiModel returns the model name from GEMINI_MODEL, or DefaultGeminiModel.
func GeminiModel() string {
	if m := strings.TrimSpace(os.Getenv("GEMINI_MODEL")); m != "" {
		return m
	}
	return DefaultGeminiModel
}

// GeminiEndpoint returns the generateContent URL for the configured model.
func GeminiEndpoint() string {
	return "https://generativelanguage.googleapis.com/v1beta/models/" +
		url.PathEscape(GeminiModel()) + ":generateContent"
}

// NewGeminiRequest builds a generateContent POST. The API key goes in the
// x-goog-api-key header so it never appears in URLs, logs or proxies.
func NewGeminiRequest(body []byte, apiKey string) (*http.Request, error) {
	req, err := http.NewRequest(http.MethodPost, GeminiEndpoint(), bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-goog-api-key", apiKey)
	return req, nil
}

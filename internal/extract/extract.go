package extract

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/ledongthuc/pdf"
)

// Kind identifies supported file categories.
type Kind string

const (
	PDF   Kind = "pdf"
	DOCX  Kind = "docx"
	Image Kind = "image"
	Text  Kind = "text"
	EPUB  Kind = "epub"
)

func KindFromPath(path string) Kind {
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(path), "."))
	switch ext {
	case "pdf":
		return PDF
	case "docx":
		return DOCX
	case "png", "jpg", "jpeg", "webp", "gif", "bmp":
		return Image
	case "txt", "md":
		return Text
	case "epub":
		return EPUB
	default:
		return ""
	}
}

func TextFromFile(path string, apiKey string, httpClient *http.Client) (string, error) {
	k := KindFromPath(path)
	switch k {
	case PDF:
		return extractPDF(path)
	case DOCX:
		return extractDOCX(path)
	case Image:
		return extractImageGemini(path, apiKey, httpClient)
	case Text:
		b, err := os.ReadFile(path)
		if err != nil {
			return "", err
		}
		return string(b), nil
	case EPUB:
		return extractEPUB(path)
	default:
		return "", fmt.Errorf("unsupported file type")
	}
}

func extractPDF(path string) (string, error) {
	f, r, err := pdf.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	rd, err := r.GetPlainText()
	if err != nil {
		return "", err
	}
	b, err := io.ReadAll(rd)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func extractDOCX(path string) (string, error) {
	zr, err := zip.OpenReader(path)
	if err != nil {
		return "", err
	}
	defer zr.Close()
	var docXML []byte
	for _, f := range zr.File {
		if f.Name == "word/document.xml" {
			rc, err := f.Open()
			if err != nil {
				return "", err
			}
			docXML, err = io.ReadAll(rc)
			_ = rc.Close()
			if err != nil {
				return "", err
			}
			break
		}
	}
	if docXML == nil {
		return "", fmt.Errorf("word/document.xml not found")
	}
	re := regexp.MustCompile(`<[^>]+>`)
	raw := re.ReplaceAllString(string(docXML), "\n")
	raw = regexp.MustCompile(`\s+`).ReplaceAllString(raw, " ")
	return strings.TrimSpace(raw), nil
}

func extractEPUB(path string) (string, error) {
	zr, err := zip.OpenReader(path)
	if err != nil {
		return "", err
	}
	defer zr.Close()
	var parts []string
	tag := regexp.MustCompile(`<[^>]+>`)
	ws := regexp.MustCompile(`\s+`)
	for _, f := range zr.File {
		n := strings.ToLower(f.Name)
		if strings.HasSuffix(n, ".xhtml") || strings.HasSuffix(n, ".html") || strings.HasSuffix(n, ".htm") {
			rc, err := f.Open()
			if err != nil {
				continue
			}
			b, err := io.ReadAll(rc)
			_ = rc.Close()
			if err != nil {
				continue
			}
			text := tag.ReplaceAllString(string(b), " ")
			text = ws.ReplaceAllString(text, " ")
			text = strings.TrimSpace(text)
			if text != "" {
				parts = append(parts, text)
			}
		}
	}
	return strings.Join(parts, "\n"), nil
}

func extractImageGemini(path, apiKey string, c *http.Client) (string, error) {
	if apiKey == "" {
		return "", fmt.Errorf("APP_API_KEY required for image extraction")
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(path), "."))
	mime := "image/jpeg"
	switch ext {
	case "png":
		mime = "image/png"
	case "webp":
		mime = "image/webp"
	case "gif":
		mime = "image/gif"
	case "bmp":
		mime = "image/bmp"
	}
	b64 := base64.StdEncoding.EncodeToString(b)
	body := map[string]any{
		"contents": []any{
			map[string]any{
				"parts": []any{
					map[string]any{
						"inline_data": map[string]any{
							"mime_type": mime,
							"data":      b64,
						},
					},
					map[string]any{"text": "Extract all text from this image and return plain text only."},
				},
			},
		},
	}
	raw, _ := json.Marshal(body)
	req, err := http.NewRequest(http.MethodPost,
		"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key="+apiKey,
		bytes.NewReader(raw))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	if c == nil {
		c = http.DefaultClient
	}
	resp, err := c.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	out, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	if resp.StatusCode >= 300 {
		return "", fmt.Errorf("gemini vision: %s: %s", resp.Status, string(out))
	}
	var wrap struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if err := json.Unmarshal(out, &wrap); err != nil {
		return "", err
	}
	if len(wrap.Candidates) == 0 || len(wrap.Candidates[0].Content.Parts) == 0 {
		return "", fmt.Errorf("empty vision response")
	}
	return strings.TrimSpace(wrap.Candidates[0].Content.Parts[0].Text), nil
}

package matching

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/shiroonigami23-ui/careerforge-go/internal/extract"
	"github.com/shiroonigami23-ui/careerforge-go/internal/store"
)

// ProcessJD extracts text from the JD file, asks Gemini for JSON chunks, embeds in store.
func ProcessJD(filePath, sessionID, apiKey string, c *http.Client, vs *store.VectorStore) error {
	text, err := extract.TextFromFile(filePath, apiKey, c)
	if err != nil {
		return err
	}
	chunks, err := chunkJD(text, apiKey, c)
	if err != nil || len(chunks) == 0 {
		// Fallback: single chunk
		chunks = []store.ChunkMeta{{ChunkText: text, Section: "job_description"}}
	}
	vs.EmbedChunks(sessionID, "jd", chunks)
	return nil
}

func chunkJD(text, apiKey string, c *http.Client) ([]store.ChunkMeta, error) {
	if apiKey == "" {
		return nil, fmt.Errorf("APP_API_KEY missing")
	}
	body := map[string]any{
		"contents": []any{
			map[string]any{
				"parts": []any{
					map[string]any{"text": text},
					map[string]any{"text": `Return ONLY a JSON array like [{"chunk_text":"...","section":"job_description"}]. No markdown fences.`},
				},
			},
		},
		"generationConfig": map[string]any{"temperature": 0.2},
	}
	raw, _ := json.Marshal(body)
	req, err := http.NewRequest(http.MethodPost,
		"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key="+apiKey,
		bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if c == nil {
		c = http.DefaultClient
	}
	resp, err := c.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	out, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("gemini jd: %s", resp.Status)
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
		return nil, err
	}
	if len(wrap.Candidates) == 0 || len(wrap.Candidates[0].Content.Parts) == 0 {
		return nil, fmt.Errorf("empty jd response")
	}
	rawText := strings.TrimSpace(wrap.Candidates[0].Content.Parts[0].Text)
	rawText = strings.TrimPrefix(rawText, "```json")
	rawText = strings.TrimPrefix(rawText, "```")
	rawText = strings.TrimSuffix(rawText, "```")
	rawText = strings.TrimSpace(rawText)

	var arr []map[string]string
	if err := json.Unmarshal([]byte(rawText), &arr); err != nil {
		return nil, err
	}
	var outChunks []store.ChunkMeta
	for _, row := range arr {
		ct := row["chunk_text"]
		sec := row["section"]
		if sec == "" {
			sec = "job_description"
		}
		if strings.TrimSpace(ct) != "" {
			outChunks = append(outChunks, store.ChunkMeta{ChunkText: ct, Section: sec})
		}
	}
	return outChunks, nil
}

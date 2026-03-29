package llm

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/shiroonigami23-ui/careerforge-go/internal/faq"
)

// Generate tries provider chain: explicit LLM_PROVIDER, then auto gemini → hf → faq.
func Generate(prompt, fallbackPrompt string, c *http.Client) string {
	final := fallbackPrompt
	if strings.TrimSpace(final) == "" {
		final = prompt
	}
	prov := strings.ToLower(strings.TrimSpace(os.Getenv("LLM_PROVIDER")))
	switch prov {
	case "gemini":
		if s, err := callGemini(final, c); err == nil && s != "" {
			return s
		}
		return faq.Fallback(prompt)
	case "hf":
		if s, err := callHF(final, c); err == nil && s != "" {
			return s
		}
		return faq.Fallback(prompt)
	}
	if s, err := callGemini(final, c); err == nil && s != "" {
		return s
	}
	if s, err := callHF(final, c); err == nil && s != "" {
		return s
	}
	return faq.Fallback(prompt)
}

func callGemini(prompt string, c *http.Client) (string, error) {
	key := strings.TrimSpace(os.Getenv("APP_API_KEY"))
	if key == "" {
		return "", fmt.Errorf("no APP_API_KEY")
	}
	body := map[string]any{
		"contents": []any{
			map[string]any{
				"parts": []any{map[string]any{"text": prompt}},
			},
		},
	}
	raw, _ := json.Marshal(body)
	req, err := http.NewRequest(http.MethodPost,
		"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key="+key,
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
		return "", fmt.Errorf("gemini: %s", resp.Status)
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
		return "", fmt.Errorf("empty")
	}
	return strings.TrimSpace(wrap.Candidates[0].Content.Parts[0].Text), nil
}

func callHF(prompt string, c *http.Client) (string, error) {
	token := strings.TrimSpace(os.Getenv("HF_TOKEN"))
	if token == "" {
		return "", fmt.Errorf("no HF")
	}
	model := strings.TrimSpace(os.Getenv("HF_MODEL_ID"))
	if model == "" {
		model = "mistralai/Mistral-7B-Instruct-v0.2"
	}
	url := "https://api-inference.huggingface.co/models/" + model
	body := map[string]any{
		"inputs": prompt,
		"parameters": map[string]any{
			"max_new_tokens": 350,
			"temperature":    0.4,
			"return_full_text": false,
		},
	}
	raw, _ := json.Marshal(body)
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+token)
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
		return "", fmt.Errorf("hf: %s", resp.Status)
	}
	var arr []struct {
		GeneratedText string `json:"generated_text"`
	}
	if json.Unmarshal(out, &arr) == nil && len(arr) > 0 {
		return strings.TrimSpace(arr[0].GeneratedText), nil
	}
	var one struct {
		GeneratedText string `json:"generated_text"`
	}
	if json.Unmarshal(out, &one) == nil && one.GeneratedText != "" {
		return strings.TrimSpace(one.GeneratedText), nil
	}
	return "", fmt.Errorf("unexpected hf response")
}

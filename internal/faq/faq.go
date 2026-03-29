package faq

import (
	_ "embed"
	"encoding/json"
	"os"
	"strings"

	"github.com/shiroonigami23-ui/careerforge-go/internal/native/seed"
)

//go:embed faq_responses.json
var embeddedFAQ []byte

type file struct {
	Intents []struct {
		Name      string   `json:"name"`
		Keywords  []string `json:"keywords"`
		Responses []string `json:"responses"`
	} `json:"intents"`
	Generic struct {
		Responses []string `json:"responses"`
	} `json:"generic"`
}

var data file

func init() {
	if len(embeddedFAQ) > 0 {
		_ = json.Unmarshal(embeddedFAQ, &data)
	}
}

func Load(path string) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, &data)
}

func stablePick(options []string, seedText string) string {
	if len(options) == 0 {
		return ""
	}
	h := hashString(seedText)
	mixed := seed.Mix(h, uint64(len(options)))
	idx := int(mixed % uint64(len(options)))
	return options[idx]
}

func hashString(s string) uint64 {
	var h uint64 = 14695981039346656037
	for _, c := range strings.ToLower(s) {
		h ^= uint64(c)
		h *= 1099511628211
	}
	return h
}

func Fallback(prompt string) string {
	lower := strings.ToLower(prompt)
	for _, intent := range data.Intents {
		for _, key := range intent.Keywords {
			if strings.Contains(lower, key) {
				return stablePick(intent.Responses, lower)
			}
		}
	}
	if len(data.Generic.Responses) > 0 {
		return stablePick(data.Generic.Responses, lower)
	}
	return "I can help with role-fit, skills gap, resume rewrite, and roadmap."
}

package quality

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// The on-device engine (frontend/src/engine/quality.js) must ignore exactly the same filler words.
func TestStopWordsMatchJSEngine(t *testing.T) {
	b, err := os.ReadFile("../../frontend/src/engine/quality.js")
	if err != nil {
		t.Fatal(err)
	}
	m := regexp.MustCompile("STOP_WORDS = new Set\\(`([^`]*)`").FindSubmatch(b)
	if m == nil {
		t.Fatal("STOP_WORDS not found in quality.js")
	}
	js := map[string]bool{}
	for _, w := range strings.Fields(string(m[1])) {
		js[w] = true
		if _, ok := stopWords[w]; !ok {
			t.Errorf("%q is a stop word in JS but not in Go", w)
		}
	}
	for w := range stopWords {
		if !js[w] {
			t.Errorf("%q is a stop word in Go but not in JS", w)
		}
	}
}

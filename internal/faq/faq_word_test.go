package faq

import "testing"

func TestContainsWordDoesNotMatchInsideWords(t *testing.T) {
	if containsWord("am i qualified for this role?", "hi") {
		t.Fatal(`"hi" must not match inside "this"`)
	}
	if !containsWord("hi there", "hi") {
		t.Fatal(`"hi" should match as a word`)
	}
	if !containsWord("what are my missing skills?", "missing skills") {
		t.Fatal("multi-word keyword should match")
	}
}

func TestFallbackQualification(t *testing.T) {
	got := Fallback("Am I qualified for this role?")
	for _, intent := range data.Intents {
		if intent.Name == "greeting" {
			for _, r := range intent.Responses {
				if r == got {
					t.Fatalf("qualification question answered with a greeting: %q", got)
				}
			}
		}
	}
}

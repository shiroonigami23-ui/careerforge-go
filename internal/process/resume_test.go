package process

import (
	"strings"
	"testing"

	"github.com/shiroonigami23-ui/careerforge-go/internal/store"
)

const sampleResume = "Aryan Singh\naryan@example.com\n+91 98765 43210\nlinkedin.com/in/aryan\n\nSKILLS\nPython Docker Kubernetes Go\n\nEXPERIENCE\nLed a migration and built 3 services, improved latency by 40%\n\nEDUCATION\nB.Tech CSE 2027\n"

func sections(t *testing.T, text string) map[string]string {
	t.Helper()
	vs := store.New()
	CleanText(text, "s", vs)
	sv, ok := vs.Get("s")
	if !ok {
		t.Fatal("no chunks stored")
	}
	out := map[string]string{}
	for _, e := range sv.Resume {
		out[e.Meta.Section] += e.Meta.ChunkText + " "
	}
	return out
}

// Regression: a skills list without "Label:" prefixes used to be dropped entirely.
func TestPlainSkillsListIsKept(t *testing.T) {
	got := sections(t, sampleResume)
	if !strings.Contains(got["skills"], "kubernetes") {
		t.Fatalf("skills section lost: %#v", got)
	}
	for _, sec := range []string{"contact", "experience", "education"} {
		if got[sec] == "" {
			t.Errorf("section %q missing: %#v", sec, got)
		}
	}
}

func TestLabelledAndShortSkillLines(t *testing.T) {
	got := sections(t, "Jane Doe\njane@x.io\n\nSKILLS\nLanguages: Go\n\nEDUCATION\nBSc Computer Science 2024\n")
	if !strings.Contains(got["skills"], "languages: go") {
		t.Errorf("short labelled skill line dropped: %#v", got)
	}
}

func TestFindNameSkipsContactDetails(t *testing.T) {
	if got := findName("aryan singh aryan@example.com +91 9876543210 linkedin.com/in/aryan"); got != "aryan_singh" {
		t.Errorf("findName = %q", got)
	}
	if got := findName(""); got != "unknown_contact" {
		t.Errorf("empty contact = %q", got)
	}
}

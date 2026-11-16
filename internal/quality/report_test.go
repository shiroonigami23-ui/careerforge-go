package quality

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"github.com/shiroonigami23-ui/careerforge-go/internal/native/coverage"
	"github.com/shiroonigami23-ui/careerforge-go/internal/store"
)

// The same fixture is checked by the JS engine test (frontend/src/engine/engine.test.js),
// so the server and the on-device engine must produce identical numbers.
type fixture struct {
	Coverage [][3]int `json:"coverage_percent"`
	Reports  []struct {
		Name   string      `json:"name"`
		Resume [][2]string `json:"resume"`
		JD     []string    `json:"jd"`
		Expect struct {
			QualityScore   int             `json:"quality_score"`
			Coverage       int             `json:"keyword_coverage"`
			SectionScore   int             `json:"section_score"`
			ActionVerbs    int             `json:"action_verb_count"`
			Quantified     int             `json:"quantified_achievement_count"`
			Contact        map[string]bool `json:"contact_checks"`
			Missing        []string        `json:"missing_keywords"`
			Recommendation int             `json:"recommendation_count"`
		} `json:"expect"`
	} `json:"reports"`
}

func loadFixture(t *testing.T) fixture {
	t.Helper()
	b, err := os.ReadFile("../../tests/fixtures/quality_cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var f fixture
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

func TestCoveragePercent(t *testing.T) {
	for _, c := range loadFixture(t).Coverage {
		if got := coverage.Percent(c[0], c[1]); got != c[2] {
			t.Errorf("Percent(%d,%d) = %d, want %d", c[0], c[1], got, c[2])
		}
	}
}

func TestQualityReportNumbers(t *testing.T) {
	for _, tc := range loadFixture(t).Reports {
		t.Run(tc.Name, func(t *testing.T) {
			vs := store.New()
			var res []store.ChunkMeta
			for _, r := range tc.Resume {
				res = append(res, store.ChunkMeta{Section: r[0], ChunkText: r[1]})
			}
			var jd []store.ChunkMeta
			for _, j := range tc.JD {
				jd = append(jd, store.ChunkMeta{Section: "job_description", ChunkText: j})
			}
			vs.EmbedChunks("s", "resume", res)
			vs.EmbedChunks("s", "jd", jd)
			got := Build("s", vs)
			if got == nil {
				t.Fatal("nil report")
			}
			e := tc.Expect
			check := func(name string, g, w int) {
				if g != w {
					t.Errorf("%s = %d, want %d", name, g, w)
				}
			}
			check("quality_score", got.QualityScore, e.QualityScore)
			check("keyword_coverage", got.KeywordCoverage, e.Coverage)
			check("section_score", got.SectionScore, e.SectionScore)
			check("action_verb_count", got.ActionVerbCount, e.ActionVerbs)
			check("quantified_achievement_count", got.QuantifiedAchievementCount, e.Quantified)
			check("recommendations", len(got.Recommendations), e.Recommendation)
			if !reflect.DeepEqual(got.ContactChecks, e.Contact) {
				t.Errorf("contact_checks = %v, want %v", got.ContactChecks, e.Contact)
			}
			if len(got.MissingKeywords)+len(e.Missing) > 0 && !reflect.DeepEqual(got.MissingKeywords, e.Missing) {
				t.Errorf("missing_keywords = %v, want %v", got.MissingKeywords, e.Missing)
			}
			if got.QualityScore < 0 || got.QualityScore > 100 {
				t.Errorf("quality_score out of range: %d", got.QualityScore)
			}
		})
	}
}

func TestQualityReportNeedsBothDocuments(t *testing.T) {
	vs := store.New()
	if Build("missing", vs) != nil {
		t.Error("unknown session should give nil")
	}
	vs.EmbedChunks("only-resume", "resume", []store.ChunkMeta{{ChunkText: "x", Section: "skills"}})
	if Build("only-resume", vs) != nil {
		t.Error("session without JD should give nil")
	}
}

package quality

import (
	"regexp"
	"sort"
	"strings"

	"github.com/shiroonigami23-ui/careerforge-go/internal/native/coverage"
	"github.com/shiroonigami23-ui/careerforge-go/internal/store"
)

// Filler words that are never treated as job keywords (kept in sync with frontend/src/engine/quality.js).
var stopWords = map[string]struct{}{
	"and": {}, "the": {}, "for": {}, "are": {}, "you": {}, "our": {}, "with": {}, "from": {}, "that": {},
	"this": {}, "have": {}, "your": {}, "must": {}, "should": {}, "will": {}, "role": {}, "team": {},
	"years": {}, "experience": {}, "about": {}, "using": {}, "into": {}, "build": {}, "ability": {},
	"required": {}, "strong": {}, "need": {}, "needs": {}, "plus": {}, "all": {}, "any": {}, "can": {},
	"has": {}, "who": {}, "what": {}, "when": {}, "where": {}, "which": {}, "how": {}, "its": {}, "not": {},
	"but": {}, "also": {}, "etc": {}, "per": {}, "out": {}, "use": {}, "via": {}, "own": {}, "may": {},
	"such": {}, "more": {}, "other": {}, "their": {}, "they": {}, "them": {}, "these": {}, "those": {},
	"than": {}, "then": {}, "over": {}, "well": {}, "work": {}, "working": {}, "able": {}, "good": {},
	"great": {}, "nice": {}, "new": {}, "including": {}, "include": {}, "includes": {}, "within": {},
	"across": {}, "both": {}, "each": {}, "few": {}, "most": {}, "some": {}, "very": {}, "just": {}, "like": {},
	"one": {}, "two": {}, "three": {}, "year": {}, "day": {}, "days": {}, "was": {}, "were": {}, "been": {},
	"being": {}, "had": {}, "having": {}, "did": {}, "does": {}, "doing": {}, "get": {}, "gets": {}, "got": {},
	"make": {}, "makes": {}, "made": {}, "want": {}, "wants": {}, "looking": {}, "seeking": {}, "ideal": {},
	"candidate": {}, "candidates": {}, "job": {}, "position": {}, "responsibilities": {}, "requirements": {},
	"preferred": {}, "bonus": {}, "knowledge": {}, "skills": {}, "understanding": {}, "familiarity": {},
	"proven": {}, "excellent": {}, "solid": {}, "hands": {}, "while": {}, "would": {}, "could": {}, "there": {},
	"here": {}, "only": {}, "same": {}, "too": {}, "why": {}, "him": {}, "her": {}, "his": {}, "she": {},
	"hers": {}, "yours": {}, "ours": {}, "whom": {}, "whose": {}, "ever": {}, "every": {}, "many": {},
	"much": {}, "less": {}, "least": {}, "based": {}, "related": {}, "relevant": {},
}

var wordTok = regexp.MustCompile(`[a-zA-Z][a-zA-Z\+\#\-]{2,}`)
var resumeWord = regexp.MustCompile(`[a-zA-Z]+`)
var numTok = regexp.MustCompile(`\b\d+(?:\.\d+)?%?\b`)
var emailRx = regexp.MustCompile(`[\w\.-]+@[\w\.-]+`)
var phoneRx = regexp.MustCompile(`\+?\d[\d\s\-]{8,}\d`)

var actionVerbs = map[string]struct{}{
	"led": {}, "built": {}, "implemented": {}, "designed": {}, "optimized": {}, "improved": {}, "delivered": {}, "managed": {},
	"developed": {}, "automated": {}, "migrated": {}, "scaled": {}, "launched": {}, "reduced": {}, "increased": {},
}

func extractKeywords(text string) []string {
	lower := strings.ToLower(text)
	var found []string
	for _, m := range wordTok.FindAllString(lower, -1) {
		if _, ok := stopWords[m]; ok {
			continue
		}
		found = append(found, m)
	}
	freq := make(map[string]int)
	for _, t := range found {
		freq[t]++
	}
	type pair struct {
		w string
		n int
	}
	var ps []pair
	for w, n := range freq {
		ps = append(ps, pair{w, n})
	}
	sort.Slice(ps, func(i, j int) bool {
		if ps[i].n == ps[j].n {
			return ps[i].w < ps[j].w
		}
		return ps[i].n > ps[j].n
	})
	var out []string
	for i := 0; i < len(ps) && i < 80; i++ {
		out = append(out, ps[i].w)
	}
	return out
}

// Report is the JSON shape returned by /analysis/quality.
type Report struct {
	QualityScore               int             `json:"quality_score"`
	KeywordCoverage            int             `json:"keyword_coverage"`
	SectionScore               int             `json:"section_score"`
	ActionVerbCount            int             `json:"action_verb_count"`
	QuantifiedAchievementCount int             `json:"quantified_achievement_count"`
	ContactChecks              map[string]bool `json:"contact_checks"`
	SectionsDetected           []string        `json:"sections_detected"`
	MatchedKeywords            []string        `json:"matched_keywords"`
	MissingKeywords            []string        `json:"missing_keywords"`
	Recommendations            []string        `json:"recommendations"`
}

func Build(sessionID string, vs *store.VectorStore) *Report {
	sv, ok := vs.Get(sessionID)
	if !ok || sv == nil {
		return nil
	}
	if len(sv.Resume) == 0 || len(sv.JD) == 0 {
		return nil
	}

	var resumeText, jdText strings.Builder
	sectionSet := map[string]struct{}{}
	for _, v := range sv.Resume {
		resumeText.WriteString(v.Meta.ChunkText)
		resumeText.WriteByte('\n')
		if v.Meta.Section != "" {
			sectionSet[v.Meta.Section] = struct{}{}
		}
	}
	for _, v := range sv.JD {
		jdText.WriteString(v.Meta.ChunkText)
		jdText.WriteByte('\n')
	}
	rt := resumeText.String()
	jt := jdText.String()

	resumeKeywords := extractKeywords(rt)
	jdKeywords := extractKeywords(jt)
	jdSet := make(map[string]struct{})
	for _, k := range jdKeywords {
		jdSet[k] = struct{}{}
	}
	resumeSet := make(map[string]struct{})
	for _, k := range resumeKeywords {
		resumeSet[k] = struct{}{}
	}
	var hits int
	for k := range jdSet {
		if _, ok := resumeSet[k]; ok {
			hits++
		}
	}
	jdTotal := len(jdSet)
	// Fortran-backed coverage percentage when available; else pure Go.
	coveragePct := coverage.Percent(hits, jdTotal)

	var sections []string
	for s := range sectionSet {
		sections = append(sections, s)
	}
	sort.Strings(sections)
	sectionScore := 100
	if len(sections) < 6 {
		sectionScore = int(float64(len(sections)) / 6.0 * 100)
	}
	if sectionScore > 100 {
		sectionScore = 100
	}

	var rw []string
	for _, w := range resumeWord.FindAllString(strings.ToLower(rt), -1) {
		rw = append(rw, w)
	}
	actionCount := 0
	for _, w := range rw {
		if _, ok := actionVerbs[w]; ok {
			actionCount++
		}
	}
	quantified := len(numTok.FindAllString(rt, -1))
	hasEmail := emailRx.FindString(rt) != ""
	hasPhone := phoneRx.FindString(rt) != ""
	hasLI := strings.Contains(strings.ToLower(rt), "linkedin")

	qualityScore := int(float64(coveragePct)*0.45 + float64(sectionScore)*0.25 + float64(min(actionCount, 25))*1.2 + float64(min(quantified, 20))*1.5)
	if qualityScore > 100 {
		qualityScore = 100
	}

	matched := []string{}
	for _, k := range jdKeywords {
		if _, ok := resumeSet[k]; ok && len(matched) < 12 {
			matched = append(matched, k)
		}
	}

	missing := []string{}
	for i, k := range jdKeywords {
		if i >= 18 {
			break
		}
		if _, ok := resumeSet[k]; !ok {
			missing = append(missing, k)
		}
	}
	if len(missing) > 8 {
		missing = missing[:8]
	}

	var recs []string
	if coveragePct < 65 {
		recs = append(recs, "Increase keyword overlap with the job description by tailoring skills, tools, and outcomes.")
	}
	if quantified < 8 {
		recs = append(recs, "Add quantified impact metrics in experience bullets (percent, counts, time, revenue, latency).")
	}
	if actionCount < 10 {
		recs = append(recs, "Rewrite bullets using stronger action verbs and clear ownership.")
	}
	if !hasLI {
		recs = append(recs, "Include LinkedIn URL in contact section for recruiter verification.")
	}
	if !hasEmail || !hasPhone {
		recs = append(recs, "Ensure both professional email and phone number are visible in contact header.")
	}
	if sectionScore < 70 {
		recs = append(recs, "Improve section coverage: add clear Skills, Experience, Projects, and Education blocks.")
	}

	return &Report{
		QualityScore:               qualityScore,
		KeywordCoverage:            coveragePct,
		SectionScore:               sectionScore,
		ActionVerbCount:            actionCount,
		QuantifiedAchievementCount: quantified,
		ContactChecks: map[string]bool{
			"email": hasEmail, "phone": hasPhone, "linkedin": hasLI,
		},
		SectionsDetected: sections,
		MatchedKeywords:  matched,
		MissingKeywords:  missing,
		Recommendations:  recs,
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

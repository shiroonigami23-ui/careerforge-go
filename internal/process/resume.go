package process

import (
	"regexp"
	"strings"
	"unicode"

	"github.com/shiroonigami23-ui/careerforge-go/internal/store"
)

var headingHints = []string{
	"profile summary", "skills", "experience", "professional experience", "projects",
	"courses", "certifications", "education", "leadership experience",
}

func isLikelyHeading(line string) bool {
	words := strings.Fields(strings.TrimSpace(line))
	if len(words) > 3 {
		return false
	}
	low := strings.ToLower(line)
	for _, h := range headingHints {
		if strings.Contains(low, h) {
			return true
		}
	}
	return false
}

var nonASCII = regexp.MustCompile(`[^\x00-\x7F]+`)

// CleanText mirrors backend/processing/cleaner.py then runs sectioner.
func CleanText(text string, sessionID string, vs *store.VectorStore) {
	var lines []string
	text = regexp.MustCompile(`[–—:|=]+`).ReplaceAllString(text, ":")
	for _, raw := range strings.Split(text, "\n") {
		line := raw
		line = strings.ReplaceAll(line, "•", "-")
		line = strings.ReplaceAll(line, "●", "-")
		line = strings.ReplaceAll(line, "▪", "-")
		line = strings.ReplaceAll(line, "■", "-")
		line = strings.ReplaceAll(line, "–", "-")
		line = strings.ReplaceAll(line, "—", "-")
		line = strings.ReplaceAll(line, "“", `"`)
		line = strings.ReplaceAll(line, "”", `"`)
		line = strings.ReplaceAll(line, "’", "'")
		line = nonASCII.ReplaceAllString(line, " ")
		line = regexp.MustCompile(`\s+`).ReplaceAllString(strings.TrimSpace(line), " ")
		if line == "" {
			continue
		}
		if isLikelyHeading(line) {
			lines = append(lines, strings.TrimSpace(line))
		} else {
			low := strings.ToLower(line)
			// Approximate Python (?<!\d)[,;!?](?!\d): strip punctuation between non-digits.
			punct := regexp.MustCompile(`([^0-9])[,;!?]([^0-9])`)
			for {
				next := punct.ReplaceAllString(low, "${1}${2}")
				if next == low {
					break
				}
				low = next
			}
			lines = append(lines, low)
		}
	}
	createSection(strings.Join(lines, "\n"), sessionID, vs)
}

func createSection(cleanedText, sessionID string, vs *store.VectorStore) {
	sections := make(map[string]string)
	currentKey := "contact"
	for _, line := range strings.Split(cleanedText, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		words := strings.Fields(line)
		if len(words) < 3 && (isLikelyTitleLine(line) || isAllUpper(line)) {
			currentKey = strings.ToLower(strings.TrimSpace(line))
			sections[currentKey] = ""
		} else {
			if sections[currentKey] == "" {
				sections[currentKey] = line + " "
			} else {
				sections[currentKey] += line + " "
			}
		}
	}
	createChunks(sections, sessionID, vs)
}

func isLikelyTitleLine(s string) bool {
	for _, w := range strings.Fields(s) {
		if w == "" {
			continue
		}
		r := []rune(w)
		if !unicode.IsUpper(r[0]) {
			return false
		}
		for _, ch := range r[1:] {
			if unicode.IsLetter(ch) && !unicode.IsLower(ch) {
				return false
			}
		}
	}
	return len(strings.Fields(s)) > 0
}

func isAllUpper(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r >= 'a' && r <= 'z' {
			return false
		}
	}
	return true
}

func toTitleWords(s string) string {
	var b strings.Builder
	for i, w := range strings.Fields(s) {
		if i > 0 {
			b.WriteByte(' ')
		}
		r := []rune(w)
		if len(r) == 0 {
			continue
		}
		r[0] = unicode.ToUpper(r[0])
		for j := 1; j < len(r); j++ {
			r[j] = unicode.ToLower(r[j])
		}
		b.WriteString(string(r))
	}
	return b.String()
}

var sectionMap = map[string][]string{
	"contact":      {"contact", "personal information"},
	"skills":       {"skills", "technologies", "tools"},
	"experience":   {"experience", "work experience", "professional experience"},
	"projects":     {"projects", "case studies"},
	"leadership":   {"leadership", "leadership experience", "positions", "roles", "extracurriculars"},
	"education":    {"education", "academics", "qualifications"},
	"certifications": {"certifications", "courses", "licenses"},
}

func mapSection(section string) string {
	s := strings.TrimSpace(strings.ToLower(section))
	for canon, syns := range sectionMap {
		for _, syn := range syns {
			if s == syn {
				return canon
			}
		}
	}
	return s
}

var ignoreNamePatterns = []*regexp.Regexp{
	regexp.MustCompile(`^\+?\d{1,3}[-\s]?\d{10}$`),
	regexp.MustCompile(`[\w\.-]+@[\w\.-]+`),
	regexp.MustCompile(`(https?:\/\/)?[\w\.]*?(linkedin|github)\.com[^\s]*`),
	regexp.MustCompile(`(email|linkedin|github|phone|contact|address)`),
	regexp.MustCompile(`^[^a-zA-Z]+$`),
}

func findName(contactText string) string {
	tokens := strings.Fields(contactText)
	var filtered []string
	for _, word := range tokens {
		skip := false
		low := strings.ToLower(word)
		for _, p := range ignoreNamePatterns {
			if p.MatchString(low) {
				skip = true
				break
			}
		}
		if !skip {
			filtered = append(filtered, word)
		}
	}
	if len(filtered) == 0 {
		return "unknown_contact"
	}
	n := 3
	if len(filtered) < n {
		n = len(filtered)
	}
	part := strings.Join(filtered[:n], " ")
	part = strings.ToLower(part)
	part = strings.ReplaceAll(part, " ", "_")
	return part
}

// Simplified from Python (RE2 has no lookahead): colon-separated skill lines.
var skillsPat = regexp.MustCompile(`(?m)\b\w[\w+#.-]*\s*:\s*[^\n]+`)

func createChunks(sample map[string]string, sessionID string, vs *store.VectorStore) {
	resumeOwner := findName(sample["contact"])
	var chunks []store.ChunkMeta

	for rawSection, text := range sample {
		section := strings.TrimSpace(strings.ToLower(rawSection))
		mapped := mapSection(section)
		text = strings.TrimSpace(text)
		if text == "" {
			continue
		}

		switch mapped {
		case "contact":
			if len(text) > 20 {
				chunks = append(chunks, store.ChunkMeta{ChunkText: text, Section: mapped, ResumeOwner: resumeOwner})
			}
		case "skills":
			for _, m := range skillsPat.FindAllString(text, -1) {
				chunkText := strings.TrimSpace(m)
				if len(chunkText) > 20 {
					chunks = append(chunks, store.ChunkMeta{ChunkText: chunkText, Section: mapped, ResumeOwner: resumeOwner})
				}
			}
		case "education", "certifications":
			chunkText := toTitleWords(rawSection) + ": " + text
			if len(chunkText) > 20 {
				chunks = append(chunks, store.ChunkMeta{ChunkText: chunkText, Section: mapped, ResumeOwner: resumeOwner})
			}
		default:
			if strings.Contains(mapped, "summary") {
				chunkText := toTitleWords(rawSection) + ": " + text
				if len(chunkText) > 20 {
					chunks = append(chunks, store.ChunkMeta{ChunkText: chunkText, Section: mapped, ResumeOwner: resumeOwner})
				}
				continue
			}
			if mapped == "experience" || mapped == "projects" || mapped == "leadership" {
				parts := regexp.MustCompile(`\s*-\s+`).Split(text, -1)
				for _, part := range parts {
					part = strings.TrimSpace(part)
					if len(part) > 20 {
						chunks = append(chunks, store.ChunkMeta{ChunkText: part, Section: mapped, ResumeOwner: resumeOwner})
					}
				}
			} else {
				if len(text) > 20 {
					chunks = append(chunks, store.ChunkMeta{ChunkText: text, Section: mapped, ResumeOwner: resumeOwner})
				}
			}
		}
	}
	vs.EmbedChunks(sessionID, "resume", chunks)
}

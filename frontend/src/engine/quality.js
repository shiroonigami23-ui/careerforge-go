// Port of internal/quality/report.go: resume-vs-JD quality report.

// Filler words that are never treated as job keywords (kept in sync with internal/quality/report.go).
const STOP_WORDS = new Set(`and the for are you our with from that this have your must should will role team years experience about using into build ability required strong need needs plus all any can has who what when where which how its not but also etc per out use via own may such more other their they them these those than then over well work working able good great nice new including include includes within across both each few most some very just like one two three year day days was were been being had having did does doing get gets got make makes made want wants looking seeking ideal candidate candidates job position responsibilities requirements preferred bonus knowledge skills understanding familiarity proven excellent solid hands while would could there here only same too why him her his she hers yours ours whom whose ever every many much less least based related relevant`.split(' '));
const ACTION_VERBS = new Set(['led', 'built', 'implemented', 'designed', 'optimized', 'improved', 'delivered', 'managed',
  'developed', 'automated', 'migrated', 'scaled', 'launched', 'reduced', 'increased']);

export function extractKeywords(text) {
  const found = (String(text).toLowerCase().match(/[a-z][a-z+#-]{2,}/g) || []).filter((w) => !STOP_WORDS.has(w));
  const freq = new Map();
  found.forEach((t) => freq.set(t, (freq.get(t) || 0) + 1));
  return [...freq.entries()]
    .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, 80)
    .map(([w]) => w);
}

// Same formula as the Fortran kernel / Go fallback in internal/native/coverage.
export const coveragePercent = (hits, total) => {
  if (total <= 0) return 0;
  const h = Math.min(Math.max(hits, 0), total);
  return Math.floor((h / total) * 100 + 0.5);
};

export function buildQualityReport(session) {
  if (!session || !session.resume?.length || !session.jd?.length) return null;
  const resumeText = session.resume.map((c) => c.chunk_text).join('\n');
  const jdText = session.jd.map((c) => c.chunk_text).join('\n');
  const sections = [...new Set(session.resume.map((c) => c.section).filter(Boolean))].sort();

  const resumeKeywords = extractKeywords(resumeText);
  const jdKeywords = extractKeywords(jdText);
  const resumeSet = new Set(resumeKeywords);
  const jdSet = new Set(jdKeywords);
  let hits = 0;
  jdSet.forEach((k) => { if (resumeSet.has(k)) hits += 1; });
  const coverage = coveragePercent(hits, jdSet.size);

  const sectionScore = Math.min(100, sections.length < 6 ? Math.floor((sections.length / 6) * 100) : 100);
  const words = resumeText.toLowerCase().match(/[a-z]+/g) || [];
  const actionCount = words.filter((w) => ACTION_VERBS.has(w)).length;
  const quantified = (resumeText.match(/\b\d+(?:\.\d+)?%?\b/g) || []).length;
  const hasEmail = /[\w.-]+@[\w.-]+/.test(resumeText);
  const hasPhone = /\+?\d[\d\s-]{8,}\d/.test(resumeText);
  const hasLinkedIn = resumeText.toLowerCase().includes('linkedin');

  const qualityScore = Math.min(100, Math.floor(coverage * 0.45 + sectionScore * 0.25
    + Math.min(actionCount, 25) * 1.2 + Math.min(quantified, 20) * 1.5));

  const matched = jdKeywords.filter((k) => resumeSet.has(k)).slice(0, 12);
  const missing = jdKeywords.slice(0, 18).filter((k) => !resumeSet.has(k)).slice(0, 8);

  const recommendations = [];
  if (coverage < 65) recommendations.push('Increase keyword overlap with the job description by tailoring skills, tools, and outcomes.');
  if (quantified < 8) recommendations.push('Add quantified impact metrics in experience bullets (percent, counts, time, revenue, latency).');
  if (actionCount < 10) recommendations.push('Rewrite bullets using stronger action verbs and clear ownership.');
  if (!hasLinkedIn) recommendations.push('Include LinkedIn URL in contact section for recruiter verification.');
  if (!hasEmail || !hasPhone) recommendations.push('Ensure both professional email and phone number are visible in contact header.');
  if (sectionScore < 70) recommendations.push('Improve section coverage: add clear Skills, Experience, Projects, and Education blocks.');

  return {
    quality_score: qualityScore,
    keyword_coverage: coverage,
    section_score: sectionScore,
    action_verb_count: actionCount,
    quantified_achievement_count: quantified,
    contact_checks: { email: hasEmail, phone: hasPhone, linkedin: hasLinkedIn },
    sections_detected: sections,
    matched_keywords: matched,
    missing_keywords: missing,
    recommendations,
  };
}

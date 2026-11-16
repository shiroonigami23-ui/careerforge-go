// Turns a quality report into a Markdown file the user can keep or share.
export function reportToMarkdown(report, { resumeName = '', jdName = '', date = new Date() } = {}) {
  if (!report) return '';
  const yes = (v) => (v ? 'yes' : 'missing');
  const lines = [
    '# CareerForge fit report',
    '',
    `Generated ${date.toLocaleString()}${resumeName ? ` for **${resumeName}**` : ''}${jdName ? ` against **${jdName}**` : ''}.`,
    '',
    '| Measure | Result |',
    '|---|---|',
    `| Overall fit score | **${report.quality_score}/100** |`,
    `| Job keywords found in résumé | ${report.keyword_coverage}% |`,
    `| Section coverage | ${report.section_score}% |`,
    `| Action verbs | ${report.action_verb_count} |`,
    `| Quantified results | ${report.quantified_achievement_count} |`,
    `| Email / phone / LinkedIn | ${yes(report.contact_checks?.email)} / ${yes(report.contact_checks?.phone)} / ${yes(report.contact_checks?.linkedin)} |`,
    '',
    '## Keywords',
    '',
    `Matched: ${(report.matched_keywords || []).join(', ') || 'none'}`,
    '',
    `Missing: ${(report.missing_keywords || []).join(', ') || 'none'}`,
    '',
    '## What to improve',
    '',
    ...((report.recommendations || []).length ? report.recommendations.map((r) => `- [ ] ${r}`) : ['Nothing urgent. Tailor the summary to each role.']),
    '',
    `Sections detected: ${(report.sections_detected || []).join(', ') || 'none'}`,
    '',
  ];
  return lines.join('\n');
}

export function downloadText(filename, text, type = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Port of internal/process/resume.go: clean resume text, split it into sections, build chunks.

const HEADING_HINTS = [
  'profile summary', 'skills', 'experience', 'professional experience', 'projects',
  'courses', 'certifications', 'education', 'leadership experience',
];

const SECTION_MAP = {
  contact: ['contact', 'personal information'],
  skills: ['skills', 'technologies', 'tools'],
  experience: ['experience', 'work experience', 'professional experience'],
  projects: ['projects', 'case studies'],
  leadership: ['leadership', 'leadership experience', 'positions', 'roles', 'extracurriculars'],
  education: ['education', 'academics', 'qualifications'],
  certifications: ['certifications', 'courses', 'licenses'],
};

const IGNORE_NAME = [
  /^\+?\d{1,3}[-\s]?\d{10}$/,
  /[\w.-]+@[\w.-]+/,
  /(https?:\/\/)?[\w.]*?(linkedin|github)\.com[^\s]*/,
  /(email|linkedin|github|phone|contact|address)/,
  /^[^a-zA-Z]+$/,
];

const isLikelyHeading = (line) => {
  if (line.trim().split(/\s+/).length > 3) return false;
  const low = line.toLowerCase();
  return HEADING_HINTS.some((h) => low.includes(h));
};

const isLikelyTitleLine = (s) => {
  const words = s.split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  return words.every((w) => /^\p{Lu}/u.test(w) && !/\p{L}/u.test(w.slice(1).replace(/\p{Ll}/gu, '')));
};

const isAllUpper = (s) => s !== '' && !/[a-z]/.test(s);

const toTitleWords = (s) => s.split(/\s+/).filter(Boolean)
  .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');

const mapSection = (section) => {
  const s = section.trim().toLowerCase();
  for (const [canon, syns] of Object.entries(SECTION_MAP)) {
    if (syns.includes(s)) return canon;
  }
  return s;
};

export const findName = (contactText = '') => {
  const filtered = contactText.split(/\s+/).filter(Boolean)
    .filter((word) => !IGNORE_NAME.some((p) => p.test(word.toLowerCase())));
  if (!filtered.length) return 'unknown_contact';
  return filtered.slice(0, 3).join(' ').toLowerCase().replace(/ /g, '_');
};

export function cleanText(text) {
  const lines = [];
  const normalised = String(text || '').replace(/[–—:|=]+/g, ':');
  for (const raw of normalised.split('\n')) {
    let line = raw
      .replace(/[•●▪■]/g, '-')
      .replace(/[–—]/g, '-')
      .replace(/[“”]/g, '"')
      .replace(/’/g, "'")
      .replace(/[^\x00-\x7F]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
    if (!line) continue;
    if (isLikelyHeading(line)) {
      lines.push(line.trim());
    } else {
      let low = line.toLowerCase();
      for (;;) {
        const next = low.replace(/([^0-9])[,;!?]([^0-9])/g, '$1$2');
        if (next === low) break;
        low = next;
      }
      lines.push(low);
    }
  }
  return lines.join('\n');
}

export function createSections(cleaned) {
  const sections = {};
  let current = 'contact';
  for (const raw of cleaned.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const words = line.split(/\s+/);
    if (words.length < 3 && (isLikelyTitleLine(line) || isAllUpper(line))) {
      current = line.toLowerCase().trim();
      sections[current] = '';
    } else {
      sections[current] = (sections[current] || '') + line + ' ';
    }
  }
  return sections;
}

const SKILLS_PAT = /\b\w[\w+#.-]*\s*:\s*[^\n]+/gm;

export function createChunks(sections) {
  const owner = findName(sections.contact);
  const chunks = [];
  const push = (chunkText, section) => {
    if (chunkText.length > 20) chunks.push({ chunk_text: chunkText, section, resume_owner: owner });
  };
  for (const [rawSection, rawText] of Object.entries(sections)) {
    const mapped = mapSection(rawSection.trim().toLowerCase());
    const text = rawText.trim();
    if (!text) continue;
    if (mapped === 'contact') push(text, mapped);
    else if (mapped === 'skills') (text.match(SKILLS_PAT) || []).forEach((m) => push(m.trim(), mapped));
    else if (mapped === 'education' || mapped === 'certifications' || mapped.includes('summary')) push(`${toTitleWords(rawSection)}: ${text}`, mapped);
    else if (['experience', 'projects', 'leadership'].includes(mapped)) text.split(/\s*-\s+/).forEach((part) => push(part.trim(), mapped));
    else push(text, mapped);
  }
  return chunks;
}

/** Full resume pipeline: raw text → chunks with sections. */
export function processResume(text) {
  const chunks = createChunks(createSections(cleanText(text)));
  // Resumes without recognisable headings still need content to analyse.
  if (!chunks.length && String(text || '').trim()) {
    return [{ chunk_text: String(text).trim(), section: 'resume', resume_owner: 'unknown_contact' }];
  }
  return chunks;
}

// AI layer for the in-app engine: Gemini (with the user's own API key) → built-in FAQ answers.
import faqData from './faq_responses.json';

const SETTINGS_KEY = 'careerforge_ai_settings_v1';
// Google's auto-updated alias for the current stable Flash model.
export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';

export function getAiSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return {
      apiKey: saved.apiKey || import.meta.env.VITE_GEMINI_API_KEY || '',
      model: saved.model || DEFAULT_GEMINI_MODEL,
    };
  } catch {
    return { apiKey: '', model: DEFAULT_GEMINI_MODEL };
  }
}

export function saveAiSettings({ apiKey, model }) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ apiKey: (apiKey || '').trim(), model: (model || '').trim() || DEFAULT_GEMINI_MODEL }));
}

async function callGemini(parts, { temperature } = {}) {
  const { apiKey, model } = getAiSettings();
  if (!apiKey) throw new Error('No Gemini API key set');
  const body = { contents: [{ parts }] };
  if (temperature !== undefined) body.generationConfig = { temperature };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  if (!text.trim()) throw new Error('Empty Gemini response');
  return text.trim();
}

export async function geminiExtractImageText(base64, mimeType) {
  try {
    return await callGemini([
      { inline_data: { mime_type: mimeType, data: base64 } },
      { text: 'Extract all text from this image and return plain text only.' },
    ]);
  } catch (error) {
    throw new Error(`Reading text from images needs a Gemini API key (Profile → AI settings). ${error.message}`);
  }
}

/** Split a job description into chunks with Gemini; falls back to one chunk (same as the Go server). */
export async function chunkJobDescription(text) {
  try {
    const raw = await callGemini([
      { text },
      { text: 'Return ONLY a JSON array like [{"chunk_text":"...","section":"job_description"}]. No markdown fences.' },
    ], { temperature: 0.2 });
    const cleaned = raw.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
    const arr = JSON.parse(cleaned);
    const chunks = arr
      .filter((row) => String(row.chunk_text || '').trim())
      .map((row) => ({ chunk_text: row.chunk_text, section: row.section || 'job_description' }));
    if (chunks.length) return chunks;
  } catch {
    // no key, network error or malformed JSON: fall through
  }
  return [{ chunk_text: text, section: 'job_description' }];
}

// FNV-1a over the lower-cased prompt, then the same XOR mix as internal/native/seed.
function hashString(s) {
  let h = 14695981039346656037n;
  for (const ch of s.toLowerCase()) {
    h ^= BigInt(ch.codePointAt(0));
    h = (h * 1099511628211n) & 0xffffffffffffffffn;
  }
  return h;
}

const stablePick = (options, seedText) => {
  if (!options?.length) return '';
  const mixed = hashString(seedText) ^ BigInt(options.length);
  return options[Number(mixed % BigInt(options.length))];
};

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Whole-word match, so the keyword "hi" does not match inside "this".
const containsWord = (text, phrase) => new RegExp(`(^|[^a-z0-9])${escapeRegExp(phrase)}($|[^a-z0-9])`).test(text);

export function faqFallback(prompt) {
  const lower = String(prompt || '').toLowerCase();
  for (const intent of faqData.intents || []) {
    if ((intent.keywords || []).some((k) => containsWord(lower, k.toLowerCase()))) return stablePick(intent.responses, lower);
  }
  if (faqData.generic?.responses?.length) return stablePick(faqData.generic.responses, lower);
  return 'I can help with role-fit, skills gap, resume rewrite, and roadmap.';
}

/** Same chain as internal/llm: Gemini, then the built-in FAQ. */
export async function generateAnswer(userPrompt, fullPrompt) {
  try {
    return await callGemini([{ text: fullPrompt || userPrompt }]);
  } catch {
    return faqFallback(userPrompt);
  }
}

export const hasAiKey = () => Boolean(getAiSettings().apiKey);

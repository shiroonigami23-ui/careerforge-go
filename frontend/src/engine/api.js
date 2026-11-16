// Chooses where API calls go:
//  - "server": the Go backend (desktop app, `go run`, or a hosted server) — same origin or VITE_API_BASE_URL
//  - "device": the in-app engine (Android/iOS apps, static hosting, or when the server is unreachable)
import { localFetch } from './localApi.js';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const FORCE_DEVICE = import.meta.env.VITE_ENGINE === 'device';

let modePromise;

async function detectMode() {
  if (FORCE_DEVICE) return 'device';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    // The Go server answers this route with a JSON body (a 404 "Profile not found"); a static host returns HTML.
    const res = await fetch(`${API_BASE_URL}/dashboard/__probe__`, { signal: controller.signal });
    clearTimeout(timer);
    const body = (await res.text()).trim();
    try {
      return typeof JSON.parse(body) === 'object' ? 'server' : 'device';
    } catch {
      return 'device';
    }
  } catch {
    return 'device';
  }
}

export function getEngineMode() {
  if (!modePromise) modePromise = detectMode();
  return modePromise;
}

/** Drop-in replacement for fetch(`${API_BASE_URL}${path}`, init). */
export async function apiFetch(path, init) {
  if ((await getEngineMode()) === 'server') return fetch(`${API_BASE_URL}${path}`, init);
  return localFetch(path, init);
}

/** File links: device mode returns blob: URLs, server mode returns /files/… paths. */
export const assetUrl = (url) => (!url || /^(blob:|data:|https?:|#)/.test(url) ? url : `${API_BASE_URL}${url}`);

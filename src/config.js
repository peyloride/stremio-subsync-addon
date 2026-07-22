/**
 * Addon configuration: defaults plus parsing of the raw config object that
 * Stremio sends. Values from Stremio's configuration UI arrive as strings,
 * so every field is coerced to its real type with a safe fallback.
 */

export const DEFAULT_CONFIG = Object.freeze({
  languages: Object.freeze(['en']),
  syncEnabled: true,
  maxOffsetSeconds: 120,
  cacheTtlDays: 30,
  opensubtitlesApiKey: '',
  subdlApiKey: '',
  subsourceApiKey: '',
  port: 3100,
  cacheDir: './data/cache',
});

const TRUTHY = new Set(['true', '1', 'yes', 'on']);
const FALSY = new Set(['false', '0', 'no', 'off']);

function parseLanguages(value) {
  if (value === undefined || value === null || value === '') {
    return [...DEFAULT_CONFIG.languages];
  }
  const parts = Array.isArray(value) ? value : String(value).split(',');
  const languages = parts
    .map((part) => String(part).trim().toLowerCase())
    .filter(Boolean);
  return languages.length > 0 ? languages : [...DEFAULT_CONFIG.languages];
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (TRUTHY.has(normalized)) return true;
  if (FALSY.has(normalized)) return false;
  return fallback;
}

function parseInteger(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.trunc(number);
}

function parseString(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const trimmed = String(value).trim();
  return trimmed === '' ? fallback : trimmed;
}

/**
 * Merge a raw Stremio config object with the defaults. `env` (defaults to
 * process.env) provides deployment-level overrides for PORT and CACHE_DIR,
 * which the raw addon config takes precedence over.
 */
export function parseConfig(raw = {}, env = process.env) {
  return {
    languages: parseLanguages(raw.languages),
    syncEnabled: parseBoolean(raw.syncEnabled, DEFAULT_CONFIG.syncEnabled),
    maxOffsetSeconds: parseInteger(raw.maxOffsetSeconds, DEFAULT_CONFIG.maxOffsetSeconds),
    cacheTtlDays: parseInteger(raw.cacheTtlDays, DEFAULT_CONFIG.cacheTtlDays),
    opensubtitlesApiKey: parseString(raw.opensubtitlesApiKey, DEFAULT_CONFIG.opensubtitlesApiKey),
    subdlApiKey: parseString(raw.subdlApiKey, DEFAULT_CONFIG.subdlApiKey),
    subsourceApiKey: parseString(raw.subsourceApiKey, DEFAULT_CONFIG.subsourceApiKey),
    port: parseInteger(raw.port ?? env.PORT, DEFAULT_CONFIG.port),
    cacheDir: parseString(raw.cacheDir, parseString(env.CACHE_DIR, DEFAULT_CONFIG.cacheDir)),
  };
}

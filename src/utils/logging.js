import { randomUUID } from 'node:crypto';

const SECRET_PARAM = /(?:api[_-]?key|apikey|key|token|secret|auth|authorization)/i;
const SECRET_HEADER = /(?:api[_-]?key|apikey|authorization|proxy-authorization|token|secret)/i;

/** Create a short correlation id for one Stremio subtitle request. */
export function createRequestId() {
  return randomUUID().slice(0, 12);
}

/** Redact credentials from URLs before they are written to logs. */
export function redactUrl(value) {
  const input = String(value ?? '');
  const absolute = /^[a-z][a-z\d+.-]*:\/\//i.test(input);
  try {
    const url = new URL(input, 'http://local.invalid');
    if (url.username || url.password) {
      url.username = '[redacted]';
      url.password = '[redacted]';
    }
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_PARAM.test(key)) url.searchParams.set(key, '[redacted]');
    }

    // Stremio puts addon config in the first URL path segment as encoded JSON.
    // Replace that entire segment so access logs cannot expose API keys.
    const segments = url.pathname.split('/');
    if (segments[1]) {
      try {
        const decoded = decodeURIComponent(segments[1]);
        if (decoded.startsWith('{') && decoded.endsWith('}') && JSON.parse(decoded)) {
          segments[1] = '[config]';
        }
      } catch {
        // Not a JSON config segment; retain the normal path.
      }
    }
    // OpenSubtitles download links contain a long, temporary signed token in
    // the path rather than the query string. Do not retain that token in logs.
    if (url.hostname.toLowerCase() === 'www.opensubtitles.com') {
      const downloadIndex = segments.findIndex((segment) => segment === 'download');
      if (downloadIndex >= 0 && segments[downloadIndex + 1]) {
        segments[downloadIndex + 1] = '[redacted]';
      }
    }

    const safePath = `${segments.join('/')}${url.search}`;
    return absolute ? `${url.origin}${safePath}` : safePath;
  } catch {
    return input.replace(/(api[_-]?key|token|secret|authorization)=?[^&\s]*/gi, '$1=[redacted]');
  }
}

/** Return only safe configuration facts; never log key values. */
export function summarizeConfig(config = {}) {
  const summary = {
    languages: Array.isArray(config.languages) ? config.languages : [],
    syncEnabled: Boolean(config.syncEnabled),
    maxOffsetSeconds: config.maxOffsetSeconds,
    cacheTtlDays: config.cacheTtlDays,
  };
  for (const key of ['opensubtitlesApiKey', 'subdlApiKey', 'subsourceApiKey']) {
    summary[key] = config[key] ? 'configured' : 'not-configured';
  }
  return summary;
}

/** Log one structured event. Fields passed here must already be safe. */
export function logEvent(event, fields = {}, level = 'log') {
  const payload = {
    time: new Date().toISOString(),
    event,
    ...fields,
  };
  // JSON output makes Coolify logs searchable while retaining readable fields.
  console[level](JSON.stringify(payload));
}

export function errorDetails(error) {
  const cause = error?.cause;
  return {
    error: error?.message ?? String(error),
    code: cause?.code ?? error?.code ?? undefined,
    cause: cause?.message ?? undefined,
  };
}

/**
 * Fetch with start/response/error logging. Each invocation represents one
 * actual upstream attempt, so retry loops produce one event per attempt.
 */
export async function fetchLogged(provider, url, options = {}, context = {}) {
  const started = Date.now();
  const method = options.method || 'GET';
  const safeUrl = redactUrl(url);
  logEvent('provider_http_request', {
    requestId: context.requestId ?? null,
    provider,
    action: context.action ?? 'request',
    attempt: context.attempt ?? null,
    method,
    url: safeUrl,
  });
  try {
    const response = await globalThis.fetch(url, options);
    logEvent('provider_http_response', {
      requestId: context.requestId ?? null,
      provider,
      action: context.action ?? 'request',
      attempt: context.attempt ?? null,
      method,
      url: safeUrl,
      status: response.status,
      ok: response.ok,
      durationMs: Date.now() - started,
    });
    return response;
  } catch (error) {
    logEvent('provider_http_error', {
      requestId: context.requestId ?? null,
      provider,
      action: context.action ?? 'request',
      attempt: context.attempt ?? null,
      method,
      url: safeUrl,
      durationMs: Date.now() - started,
      ...errorDetails(error),
    }, 'error');
    throw error;
  }
}

/** Check whether a header name could contain a credential. */
export function isSecretHeader(name) {
  return SECRET_HEADER.test(String(name));
}

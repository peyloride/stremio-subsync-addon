/**
 * Stremio addon manifest.
 *
 * `catalogs` must remain an (empty) array: the addon-sdk router reads
 * `manifest.catalogs.length` when wiring resource routes.
 */
export const manifest = {
  id: 'com.subsync.stremio',
  version: '1.2.12',
  name: 'Subtitle Sync',
  description:
    'Aggregates subtitles from multiple providers and automatically syncs them to your video using ffsubsync.',
  logo: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%2317242d'/%3E%3Ccircle cx='32' cy='22' r='9' fill='%234fc3f7'/%3E%3Cpath d='M14 40h36M14 48h24' stroke='%234fc3f7' stroke-width='4' stroke-linecap='round'/%3E%3C/svg%3E",
  background: '',
  catalogs: [],
  // Do not set a global idPrefixes filter. Nuvio may use TMDB/custom IDs
  // even when metadata originated from IMDb; filtering here prevents the
  // subtitle handler from ever being called. The handler logs unsupported IDs.
  resources: [{ name: 'subtitles', types: ['movie', 'series'] }],
  types: ['movie', 'series'],
  config: [
    {
      key: 'languages',
      type: 'select',
      title: 'Preferred languages',
      options: [
        'en', 'ar', 'zh', 'cs', 'da', 'nl', 'fi', 'fr', 'de', 'el',
        'he', 'hi', 'hu', 'id', 'it', 'ja', 'ko', 'no', 'pl', 'pt',
        'ro', 'ru', 'es', 'sv', 'th', 'tr', 'uk', 'vi',
      ],
      default: 'en',
    },
    { key: 'opensubtitlesApiKey', type: 'text', title: 'OpenSubtitles API key', required: false },
    { key: 'subdlApiKey', type: 'text', title: 'SubDL API key', required: false },
    { key: 'subsourceApiKey', type: 'text', title: 'Subsource API key', required: false },
    { key: 'syncEnabled', type: 'checkbox', title: 'Enable automatic sync', default: true },
    { key: 'maxOffsetSeconds', type: 'number', title: 'Max sync offset (seconds)', default: 120 },
    { key: 'cacheTtlDays', type: 'number', title: 'Cache TTL (days)', default: 30 },
  ],
  behaviorHints: {
    configurable: true,
  },
};

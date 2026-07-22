/**
 * Shared fixture loading and temp-directory utilities for tests.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', 'fixtures');

/**
 * Load a fixture file as a UTF-8 string.
 * @param {string} name - path relative to tests/fixtures/, e.g. 'srt/reference.srt'
 * @returns {Promise<string>}
 */
export async function loadFixture(name) {
  return readFile(join(FIXTURES_DIR, name), 'utf-8');
}

/**
 * Load a fixture file as a raw Buffer (useful for binary files like ZIPs
 * or non-UTF-8 encoded files).
 * @param {string} name - path relative to tests/fixtures/
 * @returns {Promise<Buffer>}
 */
export async function loadFixtureBuffer(name) {
  return readFile(join(FIXTURES_DIR, name));
}

/**
 * Load a JSON fixture and parse it.
 * @param {string} name - path relative to tests/fixtures/, e.g. 'providers/opensubtitles-hash.json'
 * @returns {Promise<any>}
 */
export async function loadFixtureJson(name) {
  const raw = await loadFixture(name);
  return JSON.parse(raw);
}

/**
 * Create a temporary directory for cache tests.
 * @param {string} [prefix='subsync-test-']
 * @returns {Promise<string>} absolute path to the temp directory
 */
export async function createTempCacheDir(prefix = 'subsync-test-') {
  return mkdtemp(join(tmpdir(), prefix));
}

/**
 * Remove a temporary directory and all its contents.
 * @param {string} dir - absolute path returned by createTempCacheDir
 */
export async function cleanupTempDir(dir) {
  await rm(dir, { recursive: true, force: true });
}

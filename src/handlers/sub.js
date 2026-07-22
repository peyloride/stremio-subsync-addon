import path from 'node:path';
import { promises as fs } from 'node:fs';

// Cache layout is <cacheDir>/<videoHash>/<subtitleId>.<ext>. Both path
// segments must be plain filenames so a request cannot escape the cache dir.
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9._-]+$/;

const CONTENT_TYPES = {
  '.srt': 'text/srt; charset=utf-8',
  '.ass': 'text/x-ssa; charset=utf-8',
};

/**
 * GET /sub/:videoHash/:subtitleId — serve a cached (synced) subtitle file.
 * Returns 404 for missing files, unsupported extensions and unsafe paths.
 */
export function createSubFileHandler(cacheDir) {
  const root = path.resolve(cacheDir);

  return async function subFileHandler(req, res) {
    const { videoHash, subtitleId } = req.params;

    if (
      !SAFE_PATH_SEGMENT.test(videoHash ?? '') ||
      !SAFE_PATH_SEGMENT.test(subtitleId ?? '')
    ) {
      res.status(404).end();
      return;
    }

    const contentType = CONTENT_TYPES[path.extname(subtitleId).toLowerCase()];
    if (!contentType) {
      res.status(404).end();
      return;
    }

    const filePath = path.resolve(root, videoHash, subtitleId);
    if (!filePath.startsWith(root + path.sep)) {
      res.status(404).end();
      return;
    }

    try {
      const data = await fs.readFile(filePath);
      res.setHeader('Content-Type', contentType);
      res.status(200).send(data);
    } catch {
      res.status(404).end();
    }
  };
}

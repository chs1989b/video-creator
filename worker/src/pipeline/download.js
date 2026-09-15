import path from 'node:path';
import { execFile as defaultExecFile } from './exec.js';

export async function downloadVideo(url, outputDir, { execFile = defaultExecFile } = {}) {
  const outputTemplate = path.join(outputDir, 'source.%(ext)s');
  await execFile('yt-dlp', ['-f', 'mp4', '-o', outputTemplate, url]);
  const filePath = path.join(outputDir, 'source.mp4');
  return { filePath };
}

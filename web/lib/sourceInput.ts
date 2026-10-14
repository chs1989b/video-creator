// The source video comes as a link or as an uploaded file — exactly one.
// Same limits as the worker (SOURCE_EXTENSIONS, MAX_UPLOAD_BYTES in server.js).

export const SOURCE_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm'];
export const MAX_SOURCE_BYTES = 200 * 1024 * 1024;

type FileLike = { name: string; size: number };

export function sourceInputError({ url, file }: { url: string; file: FileLike | null }): string | null {
  if (!url.trim() && !file) return '원본 영상 링크나 파일이 필요합니다.';
  if (!file) return null;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!SOURCE_EXTENSIONS.includes(ext)) return `원본 영상 파일은 ${SOURCE_EXTENSIONS.join(', ')}만 받습니다.`;
  if (file.size > MAX_SOURCE_BYTES) return `원본 영상 파일은 ${MAX_SOURCE_BYTES / 1024 / 1024}MB 이하만 올릴 수 있습니다.`;
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

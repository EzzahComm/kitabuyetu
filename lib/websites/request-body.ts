import { AppError, ValidationError } from '@/lib/utils/errors';
export async function readLimitedBody(request: Request, limit: number) {
  const reader = request.body?.getReader();
  if (!reader) throw new ValidationError('Request body is required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new AppError('Upload is too large.', 'PAYLOAD_TOO_LARGE', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export async function readWebsiteJson(request: Request, limit = 64 * 1024): Promise<unknown> {
  const bytes = await readLimitedBody(request, limit);
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new ValidationError('Send a valid JSON request.');
  }
}

import type { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { billingService } from '@/lib/services/billing.service';
import { checkHistoricalBalances } from '@/lib/services/historical-balances.service';
import { AppError, ValidationError } from '@/lib/utils/errors';
import { ok } from '@/lib/utils/response';

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_BODY_BYTES = 3 * MAX_FILE_BYTES + 16 * 1024;

// Bound the multipart decoder even when a client streams the upload without Content-Length.
async function readForm(req: NextRequest) {
  const contentType = req.headers.get('content-type') ?? '';
  if (!req.body || !/^multipart\/form-data\s*;/i.test(contentType)) {
    throw new ValidationError('Send the closing date and three CSV files as multipart/form-data.');
  }
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new AppError('Upload exceeds the batch size limit.', 'PAYLOAD_TOO_LARGE', 413);
      }
      chunks.push(value);
    }
    return await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': contentType } }).formData();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new ValidationError('Unable to read the uploaded form.');
  } finally {
    reader.releaseLock();
  }
}

async function readFile(form: FormData, name: string) {
  const values = form.getAll(name);
  const file = values[0];
  if (values.length !== 1 || typeof file === 'string' || !file || !file.size) {
    throw new ValidationError(`Attach one nonempty CSV for ${name}.`);
  }
  if (file.size > MAX_FILE_BYTES) throw new AppError(`${name} exceeds 1 MiB.`, 'PAYLOAD_TOO_LARGE', 413);
  return Buffer.from(await file.arrayBuffer());
}

export function POST(req: NextRequest): Promise<Response> {
  return withPermission(req, 'import.start', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    await billingService.assertFeatureAccess(ctx, 'historicalImport');
    const form = await readForm(req);
    const dates = form.getAll('as_of');
    if (dates.length !== 1 || typeof dates[0] !== 'string') throw new ValidationError('Choose one closing date.');
    const result = await checkHistoricalBalances(ctx, dates[0], {
      balances: await readFile(form, 'balances'),
      member_close: await readFile(form, 'member_close'),
      controls: await readFile(form, 'controls'),
    });
    const response = ok(result);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  });
}

import { readLimitedBody } from '@/lib/websites/request-body';
import type { NextRequest } from 'next/server';
import { enquiryInput, receiveEnquiry } from '@/lib/services/website-enquiries.service';
import { errorResponse, handleError, ok } from '@/lib/utils/response';
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const bytes = await readLimitedBody(req, 8192);
    let data: unknown;
    try {
      data = JSON.parse(bytes.toString('utf8'));
    } catch {
      return errorResponse('Invalid enquiry.', 'VALIDATION_ERROR', 422);
    }
    await receiveEnquiry(
      (await params).slug,
      enquiryInput.parse(data),
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
    );
    return ok({ received: true });
  } catch (err) {
    return handleError(err);
  }
}

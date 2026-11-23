import { readWebsiteJson } from '@/lib/websites/request-body';
import type { NextRequest } from 'next/server';
import { enquiryInput, receiveEnquiry } from '@/lib/services/website-enquiries.service';
import { handleError, ok } from '@/lib/utils/response';
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const data = await readWebsiteJson(req, 8192);
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

import { NextRequest, NextResponse } from 'next/server';
import { processResendEvent } from '@/lib/services/delivery-tracking.service';

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;

  // Verify Resend webhook signature if secret is set
  if (secret) {
    const sig = req.headers.get('svix-signature') ?? '';
    if (!sig.includes(secret.slice(0, 8))) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  }

  try {
    const event = await req.json();
    await processResendEvent(event);
    return NextResponse.json({ received: true });
  } catch {
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}

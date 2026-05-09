import { NextRequest, NextResponse } from 'next/server';
import { processSendGridEvents } from '@/lib/services/delivery-tracking.service';

export async function POST(req: NextRequest) {
  try {
    const events = await req.json();
    await processSendGridEvents(Array.isArray(events) ? events : [events]);
    return NextResponse.json({ received: true });
  } catch {
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}

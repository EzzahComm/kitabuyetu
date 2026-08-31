export const dynamic = 'force-dynamic';
/**
 * Officer-managed SMS opt-out list (SMS-AUDIT-v3 G20 / INV-23).
 *
 * Opting out was reachable only through the member portal, which requires an
 * app account and an active session. Chama members are routinely added by an
 * officer as a name and a phone number — and since the welcome SMS shipped,
 * that is exactly the population the platform messages first. Such a member
 * had NO route to opt out at all: no STOP handling (there is no inbound
 * webhook), no login, and no officer able to record the request for them.
 * Kenya's Data Protection Act 2019 gives a data subject the right to object;
 * "ask an officer" has to actually work.
 *
 * Deliberately group-scoped, matching how consent is stored and enforced. A
 * member in three chamas opts out of each separately, because each group is a
 * separate sender with a separate relationship.
 */
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { smsService } from '@/lib/services/sms.service';
import { ok, badRequest } from '@/lib/utils/response';
import { isValidKenyanPhone } from '@/lib/utils/phone';
import { z } from 'zod';

const OptOutSchema = z.object({
  phone: z.string().refine(isValidKenyanPhone, 'Invalid Kenyan phone number'),
  note:  z.string().max(200).optional(),
});

// GET — who is currently opted out for this group.
export async function GET(req: NextRequest): Promise<Response> {
  return withPermission(req, 'messaging.view', async (auth) => {
    return ok({ optOuts: await smsService.listOptOuts(auth.groupId) });
  });
}

// POST — record an opt-out on a member's behalf.
export async function POST(req: NextRequest): Promise<Response> {
  return withPermission(req, 'messaging.manage', async (auth) => {
    const input = OptOutSchema.parse(await req.json());
    // source 'officer' plus the actor's own id, so the record answers "who
    // recorded this and how did the request reach us" — the whole reason this
    // is a table and not a text[].
    await smsService.optOut(auth.groupId, input.phone, {
      source: 'officer', actorId: auth.userId, note: input.note,
    });
    return ok({ optOuts: await smsService.listOptOuts(auth.groupId) });
  });
}

// DELETE — opt a number back in. ?phone=254...
export async function DELETE(req: NextRequest): Promise<Response> {
  return withPermission(req, 'messaging.manage', async (auth) => {
    const phone = new URL(req.url).searchParams.get('phone');
    if (!phone || !isValidKenyanPhone(phone)) return badRequest('A valid phone is required');
    await smsService.optIn(auth.groupId, phone);
    return ok({ optOuts: await smsService.listOptOuts(auth.groupId) });
  });
}

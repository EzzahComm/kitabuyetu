/**
 * ISmsAdapter implementation for TextSMS Kenya.
 *
 * Deliberately a thin pass-through — textsms.service.ts already owns every
 * TextSMS-specific quirk (the response-code/respose-code split, the
 * delivery-status/delivery-description trap, 404-as-a-normal-DLR-answer,
 * chunking). Re-implementing any of that here would just create a second
 * place for it to drift out of sync. This class exists only so sms/provider.ts
 * can hold TextSMS behind the same interface a second provider would use.
 */
import * as textsms from '@/lib/services/textsms.service';
import type { ISmsAdapter, SingleSmsInput, BulkSmsItem } from './types';

export class TextSmsAdapter implements ISmsAdapter {
  readonly name = 'textsms';

  sendSingle(input: SingleSmsInput) {
    return textsms.sendSingleSms(input);
  }

  sendBulk(items: BulkSmsItem[]) {
    return textsms.sendBulkSmsChunked(items);
  }

  getDlr(messageId: string) {
    return textsms.getDeliveryReport(messageId);
  }

  getBalance() {
    return textsms.getProviderBalance();
  }
}

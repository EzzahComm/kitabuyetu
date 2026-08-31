/**
 * SMS segment counting (SMS-AUDIT-v3 G5 / INV-02, INV-03).
 *
 * Billing charged one credit per RECIPIENT regardless of message length, while
 * the provider bills per SEGMENT. A 300-character message is 2 GSM-7 segments,
 * or 5 if a single character forces UCS-2 — so long messages cost the platform
 * a multiple of what they billed, invisibly, with sms-margin.service reporting
 * the wrong unit as if it were right.
 *
 * The compose UI had its own, different counter (`ceil(len / 160)`), which was
 * wrong in a third way: 160 is the SINGLE-segment size, but a concatenated
 * message spends 6 of every 140 bytes on the UDH header, leaving 153 GSM-7
 * characters (or 67 UCS-2) per part. Three numbers for one message. This
 * module is the single source all of them now use.
 */

/**
 * Characters representable in the GSM 03.38 basic alphabet, one septet each.
 * Order is not significant; membership is.
 */
const GSM7_BASIC = new Set(
  ('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
   '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà')
    .split(''),
);

/**
 * GSM 03.38 extension table. Each of these is still GSM-7 encodable but costs
 * TWO septets: an 0x1B escape followed by the character. A message of 80 '€'
 * signs is therefore 160 septets — a full single segment, not half of one.
 */
const GSM7_EXTENDED = new Set(['^', '{', '}', '\\', '[', ']', '~', '|', '€']);

/** Single-segment capacity, in septets (GSM-7) or UTF-16 code units (UCS-2). */
const GSM7_SINGLE = 160;
const UCS2_SINGLE = 70;

/**
 * Concatenated capacity. Lower than the single-segment figure because a
 * multi-part message carries a 6-byte User Data Header in every part.
 */
const GSM7_CONCAT = 153;
const UCS2_CONCAT = 67;

export type SmsEncoding = 'gsm7' | 'ucs2';

export interface SegmentInfo {
  encoding: SmsEncoding;
  /** Billable parts the provider will charge for. Always >= 1. */
  segments: number;
  /** Septets for GSM-7, UTF-16 code units for UCS-2 — the unit that fills a segment. */
  units: number;
  /** Characters as a human counts them, for display next to the segment count. */
  characters: number;
}

/** True when every character is representable in GSM-7 (basic or extended). */
function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (!GSM7_BASIC.has(ch) && !GSM7_EXTENDED.has(ch)) return false;
  }
  return true;
}

/** Septet cost of a GSM-7 string — extended characters cost 2. */
function gsm7Units(text: string): number {
  let units = 0;
  for (const ch of text) units += GSM7_EXTENDED.has(ch) ? 2 : 1;
  return units;
}

/**
 * How many segments the provider will bill for this message body.
 *
 * An empty body still counts as one segment: it is a message that gets sent
 * and charged, and returning 0 would let a reservation of nothing through.
 *
 * Iterating with for..of (not .length) matters for UCS-2: an emoji outside the
 * BMP is a surrogate PAIR, occupying two UTF-16 code units on the wire, so
 * `characters` and `units` legitimately differ.
 */
export function countSegments(body: string): SegmentInfo {
  const text = body ?? '';
  const characters = [...text].length;

  if (isGsm7(text)) {
    const units = gsm7Units(text);
    return {
      encoding: 'gsm7',
      units,
      characters,
      segments: units <= GSM7_SINGLE ? 1 : Math.ceil(units / GSM7_CONCAT),
    };
  }

  // UCS-2 is billed in UTF-16 code units, which is what .length already
  // measures — a surrogate pair correctly costs 2.
  const units = text.length;
  return {
    encoding: 'ucs2',
    units,
    characters,
    segments: units <= UCS2_SINGLE ? 1 : Math.ceil(units / UCS2_CONCAT),
  };
}

/** Convenience for the many call sites that only need the billable count. */
export function segmentsOf(body: string): number {
  return countSegments(body).segments;
}

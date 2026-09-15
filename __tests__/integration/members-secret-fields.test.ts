/**
 * Regression pin for the 2026-09-14 fix to members.service.ts's stripSecrets:
 * GET /members (list) and /members/:id (getById) were leaking
 * reset_otp_hash (an unsalted SHA-256 of a 6-digit OTP), reset_otp_expires_at,
 * reset_otp_attempts and session_version to ANY authenticated group member —
 * only password_hash was ever stripped. See project memory
 * "project_kitabu_yetu_member_otp_leak" for the full trace.
 *
 * Both queries SELECT m.* deliberately, so this test exercises the real
 * service against a real row carrying all five sensitive fields set to
 * non-null values — a check that can't tell "stripped" from "was never
 * there" proves nothing.
 */
import { membersService } from "@/lib/services/members.service";
import { createTestGroup } from "./helpers/fixtures";
import { resetDatabase } from "./helpers/cleanup";
import { rawQuery } from "./helpers/db";
import type { TenantContext } from "@/lib/db";
import { MemberQuerySchema } from "@/lib/validators/member.schema";

const SENSITIVE_FIELDS = [
  "password_hash",
  "reset_otp_hash",
  "reset_otp_expires_at",
  "reset_otp_attempts",
  "session_version",
];

describe("members.service — sensitive fields never leave the service", () => {
  let groupId: string, officerId: string;
  // An ordinary member's context — the attacker's own role in the finding.
  // Sensitive-field stripping is unconditional in stripSecrets, unlike
  // applyMemberMask's phone/email/PII masking, so this must hold for every
  // role, not just 'member' — but 'member' is the one that matters most,
  // since it's the role with the least reason to trust. Assigned in
  // beforeAll, once groupId/officerId exist.
  let attackerCtx: TenantContext;

  beforeAll(async () => {
    await resetDatabase();
    ({ groupId, officerId } = await createTestGroup("treasurer", {
      subscribed: true,
    }));
    attackerCtx = { userId: officerId, groupId, role: "member" };

    // Simulate an in-flight password reset + a bumped session epoch, so the
    // row genuinely carries every sensitive field non-null — the exact state
    // an attacker would be polling for.
    await rawQuery(
      `UPDATE members
       SET reset_otp_hash = 'deadbeef00112233445566778899aabbccddeeff0011223344556677889900',
           reset_otp_expires_at = NOW() + interval '10 minutes',
           reset_otp_attempts = 2,
           session_version = 3
       WHERE id = $1`,
      [officerId],
    );
  });

  afterAll(async () => {
    await resetDatabase();
  });

  it("getById never returns password_hash, reset_otp_*, or session_version", async () => {
    const member = await membersService.getById(attackerCtx, officerId);

    for (const field of SENSITIVE_FIELDS) {
      expect(member).not.toHaveProperty(field);
    }
    // Positive control — a check that can't fail proves nothing: confirm we
    // actually got the row back, not an empty/failed result.
    expect(member.id).toBe(officerId);
    expect(member.first_name).toBeTruthy();
  });

  it("list() never returns password_hash, reset_otp_*, or session_version", async () => {
    const { items } = await membersService.list(
      attackerCtx,
      MemberQuerySchema.parse({}),
    );

    expect(items.length).toBeGreaterThan(0);
    const officerRow = items.find((m) => m.id === officerId);
    expect(officerRow).toBeDefined();

    for (const field of SENSITIVE_FIELDS) {
      expect(officerRow).not.toHaveProperty(field);
    }
    expect(officerRow!.first_name).toBeTruthy();
  });
});

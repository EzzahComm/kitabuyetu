export function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  if (phone.length < 8) return '*'.repeat(phone.length);
  return phone.slice(0, 5) + '*'.repeat(phone.length - 8) + phone.slice(-3);
}

export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const atIdx = email.indexOf('@');
  if (atIdx <= 1) return '*'.repeat(email.length);
  return email[0] + '*'.repeat(atIdx - 1) + email.slice(atIdx);
}

export function maskNationalId(id: string | null): string | null {
  if (!id) return null;
  if (id.length <= 4) return '*'.repeat(id.length);
  return id.slice(0, 4) + '*'.repeat(id.length - 4);
}

/** Apply PII masking based on the caller's role. */
export function applyMemberMask<T extends {
  phone: string;
  email: string | null;
  national_id: string | null;
  date_of_birth: Date | null;
  address: string | null;
}>(member: T, role: string): T {
  const privileged = ['super_admin', 'chairperson', 'treasurer'].includes(role);
  const adminOnly  = ['super_admin', 'chairperson'].includes(role);

  return {
    ...member,
    phone:         privileged ? member.phone        : maskPhone(member.phone)!,
    email:         privileged ? member.email        : maskEmail(member.email),
    national_id:   adminOnly  ? member.national_id  : maskNationalId(member.national_id),
    date_of_birth: adminOnly  ? member.date_of_birth : null,
    address:       adminOnly  ? member.address       : null,
  };
}

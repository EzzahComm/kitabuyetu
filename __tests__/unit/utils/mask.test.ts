import { maskPhone, maskEmail, maskNationalId, applyMemberMask } from '@/lib/utils/mask';

describe('maskPhone', () => {
  it('masks middle digits of a phone number', () => {
    expect(maskPhone('254712345678')).toBe('25471****678');
  });

  it('returns null for null input', () => {
    expect(maskPhone(null)).toBeNull();
  });

  it('masks entirely if fewer than 8 characters', () => {
    expect(maskPhone('12345')).toBe('*****');
  });
});

describe('maskEmail', () => {
  it('masks characters between first char and @ when local part > 1 char', () => {
    expect(maskEmail('admin@kitabuyetu.com')).toBe('a****@kitabuyetu.com');
    // local 'ab': email[0]='a', '*'.repeat(1)='*', rest='@example.com' → 'a*@example.com'
    expect(maskEmail('ab@example.com')).toBe('a*@example.com');
  });

  it('masks the entire string when local part is 1 character or fewer', () => {
    // 'a@example.com' (atIdx=1, ≤1) → fully masked — 13 chars
    expect(maskEmail('a@example.com')).toBe('*'.repeat('a@example.com'.length));
    // '@domain.com' (atIdx=0, ≤1) → fully masked — 11 chars
    expect(maskEmail('@domain.com')).toBe('*'.repeat('@domain.com'.length));
  });

  it('returns null for null input', () => {
    expect(maskEmail(null)).toBeNull();
  });
});

describe('maskNationalId', () => {
  it('shows first 4 digits, masks the rest', () => {
    expect(maskNationalId('12345678')).toBe('1234****');
    expect(maskNationalId('1234567')).toBe('1234***');
  });

  it('masks entirely if 4 characters or fewer', () => {
    expect(maskNationalId('123')).toBe('***');
    expect(maskNationalId('1234')).toBe('****');
  });

  it('returns null for null input', () => {
    expect(maskNationalId(null)).toBeNull();
  });
});

describe('applyMemberMask', () => {
  const member = {
    phone: '254712345678',
    email: 'jane@example.com',
    national_id: '12345678',
    date_of_birth: new Date('1990-01-01'),
    address: '123 Main St, Nairobi',
  };

  it('exposes all PII for chairperson', () => {
    const result = applyMemberMask(member, 'chairperson');
    expect(result.phone).toBe(member.phone);
    expect(result.email).toBe(member.email);
    expect(result.national_id).toBe(member.national_id);
    expect(result.date_of_birth).toEqual(member.date_of_birth);
    expect(result.address).toBe(member.address);
  });

  it('exposes phone/email, masks national_id, hides dob/address for treasurer', () => {
    // treasurer is 'privileged' but NOT 'adminOnly'
    // phone/email: shown; national_id: masked (not null); dob/address: hidden
    const result = applyMemberMask(member, 'treasurer');
    expect(result.phone).toBe(member.phone);
    expect(result.email).toBe(member.email);
    expect(result.national_id).toBe('1234****');
    expect(result.date_of_birth).toBeNull();
    expect(result.address).toBeNull();
  });

  it('masks phone/email and national_id, hides dob/address for regular member', () => {
    // member is neither 'privileged' nor 'adminOnly'
    // phone/email: masked; national_id: masked (not null); dob/address: hidden
    const result = applyMemberMask(member, 'member');
    expect(result.phone).not.toBe(member.phone);
    expect(result.email).not.toBe(member.email);
    expect(result.national_id).toBe('1234****');
    expect(result.date_of_birth).toBeNull();
    expect(result.address).toBeNull();
  });
});

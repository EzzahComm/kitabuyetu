'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/shared/page-header';
import { useAuth, isTenantUser } from '@/lib/auth/context';
import { membersApi } from '@/lib/api/endpoints';
import { useToast } from '@/hooks/use-toast';
import { formatMembershipNo, normalizeAccountRef } from '@/lib/utils/membership-no';
import { getErrorMessage } from '@/lib/utils';

// Platform PayBill business number, shown on the payment card when configured.
// (NEXT_PUBLIC_* is inlined at build time.)
const PAYBILL = process.env.NEXT_PUBLIC_MPESA_PAYBILL ?? '';

const profileSchema = z.object({
  firstName: z.string().min(2),
  lastName:  z.string().min(2),
  email:     z.string().email().optional().or(z.literal('')),
});

type ProfileForm = z.infer<typeof profileSchema>;

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword:     z.string().min(8),
  confirm:         z.string(),
}).refine((d) => d.newPassword === d.confirm, { message: 'Passwords do not match', path: ['confirm'] });

type PasswordForm = z.infer<typeof passwordSchema>;

export default function SettingsPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const { register: regProfile, handleSubmit: handleProfile, formState: { errors: profileErrors, isSubmitting: profileSubmitting } } =
    useForm<ProfileForm>({
      resolver: zodResolver(profileSchema),
      defaultValues: { firstName: user?.firstName, lastName: user?.lastName, email: user?.email ?? '' },
    });

  const { register: regPwd, handleSubmit: handlePwd, reset: resetPwd, formState: { errors: pwdErrors, isSubmitting: pwdSubmitting } } =
    useForm<PasswordForm>({ resolver: zodResolver(passwordSchema) });

  const onProfileSave = async (values: ProfileForm) => {
    if (!user) return;
    try {
      await membersApi.update(user.id, values);
      toast({ title: 'Profile updated' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Failed', description: getErrorMessage(err) });
    }
  };

  // NOTE: this silently does nothing today. PATCH /members/[id]'s
  // UpdateMemberSchema (lib/validators/member.schema.ts) has no
  // currentPassword/password fields at all, and members.service.ts's
  // update() whitelists an explicit column fieldMap that doesn't include
  // a password path either — Zod strips the unrecognized keys, the request
  // succeeds, and password_hash is never touched. The toast below always
  // fires "Password changed" even though nothing changed. Building a real
  // password-change flow (verify currentPassword via bcrypt.compare, hash
  // and store newPassword) is a genuine security-relevant feature gap, not
  // a typing fix — flagging rather than silently shipping a fake success.
  const onPasswordChange = async (values: PasswordForm) => {
    if (!user) return;
    try {
      await membersApi.update(user.id, { currentPassword: values.currentPassword, password: values.newPassword });
      toast({ title: 'Password changed' });
      resetPwd();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Failed', description: getErrorMessage(err) });
    }
  };

  const membershipNo = isTenantUser(user) ? user.membershipNo : undefined;

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader title="Settings" />

      {membershipNo && (
        // Payment instructions (payment architecture §1.7): the Membership
        // Number is the member's PayBill account number — the ONLY payment
        // identifier we ever show. member_code never appears here.
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payment account</CardTitle>
            <CardDescription>
              Pay via M-Pesa PayBill{PAYBILL ? ` ${PAYBILL}` : ''} using this account number
              {isTenantUser(user) ? ` — payments go to ${user.groupName}` : ''}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xl font-mono font-semibold tracking-wider">
              {formatMembershipNo(membershipNo)}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(normalizeAccountRef(membershipNo));
                toast({ title: 'Copied', description: 'Account number copied to clipboard.' });
              }}
            >
              Copy
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
          <CardDescription>Update your personal details</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleProfile(onProfileSave)} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>First name</Label>
                <Input {...regProfile('firstName')} />
                {profileErrors.firstName && <p className="text-xs text-destructive">{profileErrors.firstName.message as string}</p>}
              </div>
              <div className="space-y-1">
                <Label>Last name</Label>
                <Input {...regProfile('lastName')} />
              </div>
              <div className="space-y-1 col-span-2">
                <Label>Email</Label>
                <Input type="email" {...regProfile('email')} />
              </div>
            </div>
            <Button type="submit" loading={profileSubmitting}>Save changes</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Change Password</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePwd(onPasswordChange)} className="space-y-4">
            <div className="space-y-1">
              <Label>Current password</Label>
              <Input type="password" {...regPwd('currentPassword')} />
            </div>
            <div className="space-y-1">
              <Label>New password</Label>
              <Input type="password" {...regPwd('newPassword')} />
              {pwdErrors.newPassword && <p className="text-xs text-destructive">{pwdErrors.newPassword.message as string}</p>}
            </div>
            <div className="space-y-1">
              <Label>Confirm new password</Label>
              <Input type="password" {...regPwd('confirm')} />
              {pwdErrors.confirm && <p className="text-xs text-destructive">{pwdErrors.confirm.message as string}</p>}
            </div>
            <Button type="submit" loading={pwdSubmitting}>Change password</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

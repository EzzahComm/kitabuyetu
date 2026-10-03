'use client';

import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/shared/page-header';
import { useAuth, isTenantUser } from '@/lib/auth/context';
import { useCertificateFile } from '@/components/groups/signup-extras-fields';
import { membersApi, authApi, contributionsApi, groupRegistrationApi } from '@/lib/api/endpoints';
import type { GroupRegistrationStatus } from '@/lib/services/group-registration.service';
import { useToast } from '@/hooks/use-toast';
import { formatMembershipNo, normalizeAccountRef } from '@/lib/utils/membership-no';
import { getErrorMessage } from '@/lib/utils';

// Platform PayBill business number, shown on the payment card when configured.
// (NEXT_PUBLIC_* is inlined at build time.)
const PAYBILL = process.env.NEXT_PUBLIC_MPESA_PAYBILL ?? '';

const profileSchema = z.object({
  firstName: z.string().min(2),
  lastName: z.string().min(2),
  email: z.string().email().optional().or(z.literal('')),
});

type ProfileForm = z.infer<typeof profileSchema>;

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8),
    confirm: z.string(),
  })
  .refine((d) => d.newPassword === d.confirm, { message: 'Passwords do not match', path: ['confirm'] });

type PasswordForm = z.infer<typeof passwordSchema>;

// Mirrors SetContributionPlanSchema (lib/validators/contribution.schema.ts).
const planSchema = z.object({
  monthlyContribution: z.coerce.number().min(0),
  welfareAmount: z.coerce.number().min(0),
});
type PlanForm = z.infer<typeof planSchema>;

// Mirrors SetGroupRegistrationSchema (lib/validators/group.schema.ts).
const registrationSchema = z.object({
  isGovernmentRegistered: z.boolean(),
  registrationNumber: z.string().max(100).optional().or(z.literal('')),
});
type RegistrationForm = z.infer<typeof registrationSchema>;

export default function SettingsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isTenant = isTenantUser(user);
  // Only the chairperson may change the group's registration details: it is the
  // one role the database lets update the group record, and the routes enforce
  // the same. Everyone else sees the details read-only.
  const canEditRegistration = isTenantUser(user) && user.groupRole === 'chairperson';

  const {
    register: regProfile,
    handleSubmit: handleProfile,
    formState: { errors: profileErrors, isSubmitting: profileSubmitting },
  } = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: { firstName: user?.firstName, lastName: user?.lastName, email: user?.email ?? '' },
  });

  const {
    register: regPwd,
    handleSubmit: handlePwd,
    reset: resetPwd,
    formState: { errors: pwdErrors, isSubmitting: pwdSubmitting },
  } = useForm<PasswordForm>({ resolver: zodResolver(passwordSchema) });

  const {
    register: regPlan,
    handleSubmit: handlePlan,
    reset: resetPlan,
    formState: { errors: planErrors, isSubmitting: planSubmitting },
  } = useForm<PlanForm>({
    resolver: zodResolver(planSchema),
    defaultValues: { monthlyContribution: 0, welfareAmount: 0 },
  });

  const {
    register: regReg,
    handleSubmit: handleReg,
    control: regControl,
    reset: resetReg,
    formState: { isSubmitting: regSubmitting },
  } = useForm<RegistrationForm>({
    resolver: zodResolver(registrationSchema),
    defaultValues: { isGovernmentRegistered: false, registrationNumber: '' },
  });
  const regIsGovernmentRegistered = useWatch({ control: regControl, name: 'isGovernmentRegistered' });

  const [certificateUrl, setCertificateUrl] = useState<string | null>(null);
  const certificate = useCertificateFile();
  const [certUploading, setCertUploading] = useState(false);

  // Seed both finance cards from the server once, on mount — these are
  // group-scoped settings that need a real fetch, unlike Profile/Password
  // above which only ever read from the already-loaded auth context.
  useEffect(() => {
    if (!isTenant) return;
    contributionsApi
      .plan()
      .then((res) => resetPlan(res.plan))
      .catch(() => {
        /* non-fatal — the form just keeps its 0/0 defaults */
      });
    groupRegistrationApi
      .get()
      .then((res: GroupRegistrationStatus) => {
        resetReg({
          isGovernmentRegistered: res.isGovernmentRegistered,
          registrationNumber: res.registrationNumber ?? '',
        });
        setCertificateUrl(res.certificateUrl);
      })
      .catch(() => {
        /* non-fatal — the form just keeps its "not registered" defaults */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTenant]);

  const onPlanSave = async (values: PlanForm) => {
    try {
      await contributionsApi.setPlan(values);
      toast({ title: 'Contribution & welfare plan saved' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Save failed', description: getErrorMessage(err) });
    }
  };

  const onRegSave = async (values: RegistrationForm) => {
    try {
      const res = await groupRegistrationApi.setStatus({
        isGovernmentRegistered: values.isGovernmentRegistered,
        registrationNumber: values.registrationNumber || null,
      });
      setCertificateUrl(res.certificateUrl);
      toast({ title: 'Registration status saved' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Save failed', description: getErrorMessage(err) });
    }
  };

  const onCertUpload = async () => {
    if (!certificate.file) return;
    setCertUploading(true);
    try {
      const res = await groupRegistrationApi.uploadCertificate(certificate.file);
      setCertificateUrl(res.certificateUrl);
      certificate.reset();
      toast({ title: 'Certificate uploaded' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Upload failed', description: getErrorMessage(err) });
    } finally {
      setCertUploading(false);
    }
  };

  const onProfileSave = async (values: ProfileForm) => {
    if (!user) return;
    try {
      await membersApi.update(user.id, values);
      toast({ title: 'Profile updated' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Failed', description: getErrorMessage(err) });
    }
  };

  const onPasswordChange = async (values: PasswordForm) => {
    if (!user) return;
    try {
      // Real endpoint as of CLIENT_SERVER_CONTRACT_AUDIT_2026-08.md — this used
      // to PATCH /members/[id] with fields that schema ignores, so it always
      // reported success without changing anything.
      await authApi.changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      toast({
        title: 'Password changed',
        description: 'Other devices have been signed out.',
      });
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
            <p className="text-xl font-mono font-semibold tracking-wider">{formatMembershipNo(membershipNo)}</p>
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

      {isTenant && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contribution & welfare plan</CardTitle>
            <CardDescription>
              What each member owes every month. Members who fall behind get a monthly SMS showing their balance and
              where to pay.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handlePlan(onPlanSave)} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Monthly contribution (KES)</Label>
                  <Input type="number" min="0" step="1" {...regPlan('monthlyContribution')} />
                  {planErrors.monthlyContribution && (
                    <p className="text-xs text-destructive">{planErrors.monthlyContribution.message}</p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label>Welfare amount (KES)</Label>
                  <Input type="number" min="0" step="1" {...regPlan('welfareAmount')} />
                  {planErrors.welfareAmount && (
                    <p className="text-xs text-destructive">{planErrors.welfareAmount.message}</p>
                  )}
                </div>
              </div>
              <Button type="submit" loading={planSubmitting}>
                Save plan
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {isTenant && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Group registration</CardTitle>
            <CardDescription>
              Optional — add this now or later. It never affects your group&apos;s ability to onboard members or
              subscribe.
              {!canEditRegistration && ' Only the group chairperson can change it.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleReg(onRegSave)} className="space-y-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  disabled={!canEditRegistration}
                  {...regReg('isGovernmentRegistered')}
                />
                Registered (e.g. with the Social Services / Cooperatives / NGO Board)
              </label>
              {regIsGovernmentRegistered && (
                <div className="space-y-1">
                  <Label>Registration number</Label>
                  <Input
                    placeholder="e.g. CBO/12345/2024"
                    disabled={!canEditRegistration}
                    {...regReg('registrationNumber')}
                  />
                </div>
              )}
              {canEditRegistration && (
                <Button type="submit" loading={regSubmitting}>
                  Save
                </Button>
              )}
            </form>

            <div className="pt-2 border-t space-y-2">
              <Label>Certificate (PDF)</Label>
              {certificateUrl ? (
                <p className="text-sm">
                  <a href={certificateUrl} target="_blank" rel="noreferrer" className="text-brand-600 underline">
                    View current certificate
                  </a>{' '}
                  {canEditRegistration && (
                    <span className="text-muted-foreground">— uploading a new file replaces it.</span>
                  )}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">No certificate uploaded yet.</p>
              )}
              {canEditRegistration && (
                <>
                  <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                    <Input
                      key={certificate.inputKey}
                      type="file"
                      accept="application/pdf"
                      onChange={certificate.onSelect}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      loading={certUploading}
                      disabled={!certificate.file}
                      onClick={onCertUpload}
                    >
                      Upload
                    </Button>
                  </div>
                  {certificate.error && <p className="text-xs text-destructive">{certificate.error}</p>}
                </>
              )}
            </div>
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
                {profileErrors.firstName && (
                  <p className="text-xs text-destructive">{profileErrors.firstName.message as string}</p>
                )}
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
            <Button type="submit" loading={profileSubmitting}>
              Save changes
            </Button>
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
              {pwdErrors.newPassword && (
                <p className="text-xs text-destructive">{pwdErrors.newPassword.message as string}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label>Confirm new password</Label>
              <Input type="password" {...regPwd('confirm')} />
              {pwdErrors.confirm && <p className="text-xs text-destructive">{pwdErrors.confirm.message as string}</p>}
            </div>
            <Button type="submit" loading={pwdSubmitting}>
              Change password
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

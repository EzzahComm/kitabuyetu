'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/auth/context';
import { membersApi } from '@/lib/api/endpoints';
import { useToast } from '@/hooks/use-toast';

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

  const onProfileSave = async (values: any) => {
    if (!user) return;
    try {
      await membersApi.update(user.id, values);
      toast({ title: 'Profile updated' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Failed', description: err.message });
    }
  };

  const onPasswordChange = async (values: any) => {
    if (!user) return;
    try {
      await membersApi.update(user.id, { currentPassword: values.currentPassword, password: values.newPassword });
      toast({ title: 'Password changed' });
      resetPwd();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Failed', description: err.message });
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
          <CardDescription>Update your personal details</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleProfile(onProfileSave)} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
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

'use client';

import { useRouter } from 'next/navigation';
import { Shield, LogOut, Mail, User, Smartphone, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/shared/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth, isBackofficeUser } from '@/lib/auth/context';
import { useC2BUrls, useRegisterC2BUrls } from '@/hooks/use-admin';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/utils';

const ROLE_LABELS: Record<string, string> = {
  super_admin:              'Super Admin',
  support:                  'Support',
  organization_coordinator: 'Organization Coordinator',
};

export default function AdminSettingsPage() {
  const { user, logout } = useAuth();
  const router = useRouter();

  const staff = isBackofficeUser(user) ? user : null;

  const handleSignOut = () => {
    logout();
    router.replace('/admin-login');
  };

  return (
    <div className="space-y-5 max-w-2xl">
      <PageHeader title="Settings" description="Your backoffice account" />

      {/* Account */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <User size={16} className="text-gray-400" /> Account
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Row label="Name" value={staff ? `${staff.firstName} ${staff.lastName}` : '—'} />
          <Row
            label="Email"
            value={staff?.email ?? '—'}
            icon={<Mail size={13} className="text-gray-400" />}
          />
          <Row
            label="Role"
            value={staff ? (ROLE_LABELS[staff.platformRole] ?? staff.platformRole) : '—'}
            icon={<Shield size={13} className="text-gray-400" />}
          />
        </CardContent>
      </Card>

      {staff?.platformRole === 'super_admin' && <C2BRegistrationCard />}

      {/* Session */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Session</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            You are signed in to the backoffice portal. Actions here are logged.
          </p>
          <Button variant="outline" onClick={handleSignOut} className="gap-2">
            <LogOut size={15} /> Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * M-Pesa C2B (PayBill) registration. Safaricom exposes no "what's currently
 * registered" read, and nothing in the app re-registers on its own — this is
 * the one on-demand control for a class of failure (stale/misconfigured
 * registration) that otherwise fails completely silently: money arrives on
 * the paybill and the app never hears about it.
 */
function C2BRegistrationCard() {
  const { data: urls, isLoading } = useC2BUrls();
  const register = useRegisterC2BUrls();
  const { toast } = useToast();

  const handleRegister = () => {
    register.mutate(undefined, {
      onSuccess: (result) => {
        toast({
          title: 'C2B URLs registered with Safaricom',
          description: result.responseDescription ?? `Response code ${result.responseCode ?? '—'}`,
        });
      },
      onError: (e) => {
        toast({ variant: 'destructive', title: 'Registration failed', description: getErrorMessage(e) });
      },
    });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Smartphone size={16} className="text-gray-400" /> M-Pesa C2B Registration
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Confirmation/Validation URLs registered with Safaricom for PayBill payments. Safaricom
          has no read API for this — re-register whenever the callback config changes or a paybill
          payment goes missing.
        </p>
        {isLoading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : urls ? (
          <>
            <Row
              label="Environment"
              value=""
              valueSlot={
                <Badge variant={urls.environment === 'production' ? 'success' : 'secondary'}>
                  {urls.environment}
                </Badge>
              }
            />
            <Row label="Shortcode" value={urls.shortCode} />
            <div className="space-y-1 pt-1">
              <div className="text-gray-500">This deployment would register</div>
              <code className="block break-all rounded bg-gray-50 px-2 py-1.5 text-xs text-gray-700">
                {urls.confirmationUrl}
              </code>
              <code className="block break-all rounded bg-gray-50 px-2 py-1.5 text-xs text-gray-700">
                {urls.validationUrl}
              </code>
            </div>
          </>
        ) : (
          <p className="text-destructive">Could not load current configuration.</p>
        )}
        <Button
          variant="outline"
          onClick={handleRegister}
          disabled={register.isPending}
          className="gap-2"
        >
          <RefreshCw size={15} className={register.isPending ? 'animate-spin' : ''} />
          {register.isPending ? 'Registering…' : 'Register with Safaricom'}
        </Button>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, icon, valueSlot }: {
  label: string; value: string; icon?: React.ReactNode; valueSlot?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-gray-500">{label}</span>
      {valueSlot ?? (
        <span className="flex items-center gap-1.5 font-medium text-gray-900">{icon}{value}</span>
      )}
    </div>
  );
}

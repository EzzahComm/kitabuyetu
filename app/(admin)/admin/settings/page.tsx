'use client';

import { useRouter } from 'next/navigation';
import { Settings, Shield, LogOut, Mail, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth, isBackofficeUser } from '@/lib/auth/context';

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
      <div>
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <Settings size={20} className="text-gray-500" /> Settings
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">Your backoffice account</p>
      </div>

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

function Row({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-gray-500">{label}</span>
      <span className="flex items-center gap-1.5 font-medium text-gray-900">{icon}{value}</span>
    </div>
  );
}

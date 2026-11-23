'use client';
import { isTenantUser, useAuth } from '@/lib/auth/context';
import { DomainSettings } from '@/components/groups/domain-settings';
export default function ReminderDomainPage() {
  const { user } = useAuth();
  return isTenantUser(user) && user.groupRole === 'chairperson' ? (
    <DomainSettings key={user.groupId} groupId={user.groupId} userId={user.id} />
  ) : (
    <p>The group chairperson manages the website connection.</p>
  );
}

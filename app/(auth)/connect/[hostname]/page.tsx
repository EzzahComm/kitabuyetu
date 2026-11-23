import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { connectedGroup } from '@/lib/group-domains/service';
import { grantRequest, hostnameSchema } from '@/lib/group-domains/protocol';
import { DomainConsent } from '@/components/groups/domain-consent';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Group sign-in | Kitabu Yetu',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default async function Connect({
  params,
  searchParams,
}: {
  params: Promise<{ hostname: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const host = hostnameSchema.safeParse((await params).hostname);
  if (!host.success) notFound();
  const query = await searchParams;
  const parsed = grantRequest.safeParse({ ...query, hostname: host.data });
  if (Object.keys(query).length && (!parsed.success || 'hostname' in query))
    return <p role="alert">This sign-in request is invalid. Start again from your group website.</p>;
  const group = await connectedGroup(host.data);
  if (!group) notFound();
  return (
    <DomainConsent
      hostname={host.data}
      groupId={group.group_id}
      groupName={group.group_name}
      grant={parsed.success ? parsed.data : null}
    />
  );
}

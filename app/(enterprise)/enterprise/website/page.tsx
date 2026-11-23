'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { adminApi } from '@/lib/api/client';
import { isBackofficeUser, useAuth } from '@/lib/auth/context';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { WebsiteInbox } from '@/components/websites/website-inbox';
import { PublicSite } from '@/components/websites/public-site';
import { getErrorMessage } from '@/lib/utils';
import type { websiteStudio } from '@/lib/services/organization-websites.service';
import { siteFields, type WebsiteDraft, type WebsiteCommand } from '@/lib/websites/content';

type Studio = Awaited<ReturnType<typeof websiteStudio>>;
const endpoint = '/organization/website';
export default function StudioPage() {
  const { user } = useAuth();
  const org = isBackofficeUser(user) ? user.organizationId : null;
  const query = useQuery({
    queryKey: ['website-studio', org, user?.id],
    queryFn: () => adminApi.get<Studio>(endpoint),
    enabled: !!org,
    retry: false,
    refetchOnWindowFocus: false,
  });
  if (!org) return <p>Select an organization to open Website Studio.</p>;
  if (query.error) return <p role="alert">{getErrorMessage(query.error)}</p>;
  if (!query.data) return <p>Loading website…</p>;
  return (
    <Editor
      key={org + ':' + query.data.revision}
      site={query.data}
      reload={async () => {
        await query.refetch({ throwOnError: true });
      }}
    />
  );
}
function Editor({ site, reload }: { site: Studio; reload: () => Promise<void> }) {
  const [draft, setDraft] = useState<WebsiteDraft>(site.draft);
  const [busy, setBusy] = useState(false);
  const [art, setArt] = useState(site.choices.artwork);
  const [alt, setAlt] = useState('');
  async function upload(file?: File) {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const image = await adminApi.uploadImage(endpoint + '/artwork?alt=' + encodeURIComponent(alt), file);
      setArt((current) => [...current, image]);
      setAlt('');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  const [error, setError] = useState('');
  const dirty = JSON.stringify(site.draft) !== JSON.stringify(draft);
  async function command(data: WebsiteCommand) {
    setBusy(true);
    setError('');
    try {
      await adminApi.post(endpoint, data);
      await reload();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  function textField(
    key: 'name' | 'headline' | 'introduction' | 'about' | 'contactEmail',
    label: string,
    multiline = false,
  ) {
    const props = {
      value: draft[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setDraft({ ...draft, [key]: e.target.value }),
    };
    return (
      <label className="grid gap-1 text-sm font-medium">
        {label}
        {multiline ? <Textarea {...props} rows={4} /> : <Input {...props} />}
      </label>
    );
  }
  function sources(key: 'programIds' | 'campaignIds', label: string, items: { id: string; label: string }[]) {
    const obsolete = draft[key].filter((id) => !items.some((i) => i.id === id));
    if (!items.length && !obsolete.length) return null;
    return (
      <fieldset className="space-y-2">
        <legend className="font-semibold">{label}</legend>
        {[...items, ...obsolete.map((id) => ({ id, label: 'Unavailable source — clear to remove' }))].map((item) => (
          <label key={item.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft[key].includes(item.id)}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  [key]: e.target.checked ? [...draft[key], item.id] : draft[key].filter((id) => id !== item.id),
                })
              }
            />
            {item.label}
          </label>
        ))}
      </fieldset>
    );
  }
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-3xl font-semibold">Website Studio</h1>
        <p className="text-sm text-muted-foreground">
          {site.publication ? (
            <>
              Published at{' '}
              <a className="underline" href={'/sites/' + site.slug}>
                /sites/{site.slug}
              </a>
            </>
          ) : (
            'Private draft'
          )}{' '}
          · Revision {site.revision}
        </p>
      </header>
      <fieldset disabled={busy} className="space-y-5 rounded-xl border bg-background p-5">
        <details>
          <summary className="cursor-pointer">Import prepared website copy</summary>
          <label className="mt-3 grid gap-1 text-sm">
            Editorial JSON file
            <Input
              type="file"
              accept=".json,application/json"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  if (file.size > 65536) throw new Error('Use a file smaller than 64 KiB.');
                  const parsed = siteFields.safeParse(JSON.parse(await file.text()));
                  if (!parsed.success) throw new Error('This file does not match the website copy format.');
                  setDraft((current) => ({ ...current, ...parsed.data }));
                  setError('');
                } catch (err) {
                  setError(getErrorMessage(err));
                }
              }}
            />
          </label>
        </details>
        <div className="grid gap-4 md:grid-cols-2">
          {textField('name', 'Website name')}
          {textField('headline', 'Headline')}
        </div>
        {textField('introduction', 'Introduction', true)}
        {textField('about', 'About the organization', true)}
        <details>
          <summary>Brand and artwork</summary>
          <div className="mt-3 grid gap-3">
            <label>
              Brand accent{' '}
              <Input
                type="color"
                value={draft.accent}
                onChange={(e) => setDraft({ ...draft, accent: e.target.value })}
              />
            </label>
            <label>
              Image description <Input value={alt} maxLength={180} onChange={(e) => setAlt(e.target.value)} />
            </label>
            <label>
              Upload approved artwork (JPEG, PNG or WebP, up to 2 MiB)
              <Input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={!alt.trim()}
                onChange={(e) => void upload(e.target.files?.[0])}
              />
            </label>
            {(['logoId', 'coverId'] as const).map((key) => (
              <label key={key}>
                {key === 'logoId' ? 'Logo' : 'Cover photograph'}
                <select
                  className="ml-2 border p-2"
                  value={draft[key] ?? ''}
                  onChange={(e) => setDraft({ ...draft, [key]: e.target.value || null })}
                >
                  <option value="">Template default</option>
                  {art.map((image) => (
                    <option key={image.id} value={image.id}>
                      {image.alt}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            {art
              .filter(
                (image) => ![draft.logoId, draft.coverId, site.draft.logoId, site.draft.coverId].includes(image.id),
              )
              .map((image) => (
                <Button
                  key={image.id}
                  variant="outline"
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await adminApi.delete(endpoint + '/artwork?id=' + image.id);
                      setArt((current) => current.filter((item) => item.id !== image.id));
                    } catch (e) {
                      setError(getErrorMessage(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Delete unused image · {image.alt}
                </Button>
              ))}
          </div>
        </details>
        {textField('contactEmail', 'Public contact email (optional)')}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.acceptEnquiries}
            onChange={(e) => setDraft({ ...draft, acceptEnquiries: e.target.checked })}
          />
          Receive website enquiries in this workspace
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.memberAccess}
            onChange={(e) => setDraft({ ...draft, memberAccess: e.target.checked })}
          />
          Show member sign in for Bookkeeper and Chama Reminder
        </label>
        <section className="space-y-3">
          <h2 className="font-semibold">Programme descriptions</h2>
          {draft.stories.map((story, i) => (
            <div key={i} className="grid gap-2 rounded border p-3">
              <label>
                Programme title
                <Input
                  value={story.title}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      stories: draft.stories.map((v, j) => (j === i ? { ...v, title: e.target.value } : v)),
                    })
                  }
                />
              </label>
              <label>
                Public description
                <Textarea
                  value={story.description}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      stories: draft.stories.map((v, j) => (j === i ? { ...v, description: e.target.value } : v)),
                    })
                  }
                />
              </label>
              <Button
                variant="outline"
                className="justify-self-start"
                onClick={() => setDraft({ ...draft, stories: draft.stories.filter((_, j) => j !== i) })}
              >
                Remove description
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            disabled={draft.stories.length >= 20}
            onClick={() => setDraft({ ...draft, stories: [...draft.stories, { title: '', description: '' }] })}
          >
            Add programme description
          </Button>
        </section>
        {sources(
          'programIds',
          'Enterprise programmes to publish',
          site.choices.programs.map((p) => ({ id: p.id, label: p.name })),
        )}
        {sources(
          'campaignIds',
          'Changi$ha fundraisers to feature',
          site.choices.campaigns.map((c) => ({ id: c.id, label: c.title })),
        )}
        <div className="flex flex-wrap gap-4 text-sm">
          <Link className="underline" href="/enterprise/programs">
            Manage programmes
          </Link>
          <Link className="underline" href="/enterprise/groups">
            Manage linked groups
          </Link>
        </div>
        <Button
          disabled={!dirty}
          onClick={() => command({ action: 'save', slug: site.slug, revision: site.revision, draft })}
        >
          Save draft
        </Button>
      </fieldset>
      {error && (
        <p role="alert" className="text-destructive">
          {error}{' '}
          <button className="underline" onClick={() => void reload().catch((e) => setError(getErrorMessage(e)))}>
            Reload saved draft
          </button>
        </p>
      )}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Saved preview</h2>
        {dirty && <p>Save your changes to update the preview.</p>}
        {site.preview ? (
          <PublicSite site={site.preview.snapshot} />
        ) : (
          <p>Remove unavailable sources and save to refresh the preview.</p>
        )}
        {site.canPublish && (
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={busy || dirty || !site.preview}
              onClick={() =>
                site.preview &&
                command({ action: 'publish', slug: site.slug, revision: site.revision, digest: site.preview.digest })
              }
            >
              Publish reviewed preview
            </Button>
            {site.publication && (
              <Button
                disabled={busy || dirty}
                variant="outline"
                onClick={() => command({ action: 'unpublish', slug: site.slug, revision: site.revision })}
              >
                Withdraw public site
              </Button>
            )}
          </div>
        )}
      </section>
      <WebsiteInbox site={site.slug} />
    </div>
  );
}

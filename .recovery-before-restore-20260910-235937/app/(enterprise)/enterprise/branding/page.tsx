'use client';

/**
 * White-label branding — logo + primary color only
 * (ORGANIZATION_LOGIN_ARCHITECTURE_AUDIT.md Phase 4; migration 109). Scope
 * decided via AskUserQuestion, 2026-08-02: no custom domain, no upload
 * pipeline (plain URL field, mirrors group_email_branding's existing
 * pattern) — the smallest real version of "white-label".
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Image from 'next/image';
import { Palette } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { organizationApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_COLOR = '#16a34a';

export default function BrandingPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['enterprise', 'branding'],
    queryFn:  () => organizationApi.branding(),
  });

  const [logoUrl, setLogoUrl] = useState('');
  const [primaryColor, setPrimaryColor] = useState(DEFAULT_COLOR);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLogoUrl(data.logoUrl ?? '');
    setPrimaryColor(data.primaryColor ?? DEFAULT_COLOR);
  }, [data]);

  const colorValid = HEX_PATTERN.test(primaryColor);
  const logoValid = logoUrl === '' || /^https?:\/\//.test(logoUrl);

  const save = async () => {
    if (!colorValid) {
      toast({ variant: 'destructive', title: 'Enter a valid hex color, e.g. #16a34a' });
      return;
    }
    if (!logoValid) {
      toast({ variant: 'destructive', title: 'Logo must be a full URL (https://…)' });
      return;
    }
    setSaving(true);
    try {
      await organizationApi.setBranding({
        logoUrl: logoUrl.trim() || null,
        primaryColor: primaryColor.trim() || null,
      });
      toast({ title: 'Branding updated' });
      await qc.invalidateQueries({ queryKey: ['enterprise', 'branding'] });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not save branding', description: err instanceof ApiError ? err.message : '' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Branding"
        description="Your logo and brand color, shown across the enterprise portal."
        breadcrumbs={[{ label: 'Portfolio', href: '/enterprise' }, { label: 'Branding' }]}
      />

      {isLoading ? (
        <Skeleton className="h-64 w-full max-w-xl" />
      ) : (
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Palette size={16} /> Logo &amp; color</CardTitle>
            <CardDescription>Logo must be a hosted image URL — there&apos;s no upload here yet.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="logoUrl">Logo URL</Label>
              <Input
                id="logoUrl"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://example.com/logo.png"
              />
              {!logoValid && <p className="text-xs text-destructive">Must start with https:// or http://</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="primaryColor">Primary color</Label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={colorValid ? primaryColor : DEFAULT_COLOR}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="h-10 w-14 cursor-pointer rounded-md border border-input bg-background"
                  aria-label="Pick primary color"
                />
                <Input
                  id="primaryColor"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  placeholder="#16a34a"
                  className="max-w-[140px] font-mono"
                />
              </div>
              {!colorValid && <p className="text-xs text-destructive">Must be a hex color like #16a34a</p>}
            </div>

            <div className="rounded-lg border p-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Preview</p>
              <div className="flex items-center gap-2.5">
                {logoUrl && logoValid ? (
                  <Image src={logoUrl} alt="Logo preview" width={28} height={28} className="rounded-md object-contain" unoptimized />
                ) : (
                  <span
                    className="flex h-7 w-7 items-center justify-center rounded-md text-sm font-bold text-white"
                    style={{ backgroundColor: colorValid ? primaryColor : DEFAULT_COLOR }}
                  >
                    K
                  </span>
                )}
                <span className="text-sm font-semibold text-foreground">
                  Kitabu <span style={{ color: colorValid ? primaryColor : DEFAULT_COLOR }}>Enterprise</span>
                </span>
              </div>
            </div>

            <Button onClick={save} loading={saving} disabled={!colorValid || !logoValid}>
              Save branding
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

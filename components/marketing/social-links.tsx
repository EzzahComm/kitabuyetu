import { Facebook, Instagram, Linkedin, Youtube, type LucideIcon } from 'lucide-react';
import { WhatsAppLogo, XLogo } from './brand-icons';
import { cn } from '@/lib/utils';
import { SOCIAL_LINKS, type SocialLink, type SocialPlatform } from './routes';

const ICONS: Record<SocialPlatform, LucideIcon> = {
  facebook: Facebook,
  x: XLogo,
  linkedin: Linkedin,
  instagram: Instagram,
  youtube: Youtube,
  whatsapp: WhatsAppLogo,
};

const VARIANT: Record<'nav' | 'footer' | 'card', string> = {
  // Finanza navbar: soft lavender circle, primary glyph.
  nav: 'h-8 w-8 bg-brand-100 text-brand-500 hover:bg-brand-500 hover:text-white',
  // Finanza footer: outlined light circle on the dark ground.
  footer: 'h-9 w-9 border border-white/40 text-white/80 hover:border-brand-500 hover:bg-brand-500 hover:text-white',
  // Finanza team card: lavender circle that inverts to primary.
  card: 'h-9 w-9 bg-brand-100 text-brand-500 hover:bg-brand-500 hover:text-white',
};

interface SocialLinksProps {
  variant: keyof typeof VARIANT;
  className?: string;
  /** Limit to these platforms, in this order. */
  only?: SocialPlatform[];
  /** Whose profiles. Defaults to the company's SOCIAL_LINKS. */
  links?: SocialLink[];
}

export function SocialLinks({ variant, className, only, links: source = SOCIAL_LINKS }: SocialLinksProps) {
  const links = only ? only.flatMap((platform) => source.filter((link) => link.platform === platform)) : source;

  return (
    <ul className={cn('flex items-center gap-2', className)}>
      {links.map(({ platform, label, href }) => {
        const Glyph = ICONS[platform];
        const base = cn(
          'flex shrink-0 items-center justify-center rounded-full transition-colors duration-300',
          VARIANT[variant],
        );
        return (
          <li key={platform}>
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={label}
                className={cn(
                  base,
                  'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
                )}
              >
                <Glyph aria-hidden="true" size={16} strokeWidth={1.75} />
              </a>
            ) : (
              // No profile URL yet: keep the template's icon row, but never as a dead link.
              <span aria-hidden="true" className={cn(base, 'cursor-default')}>
                <Glyph size={16} strokeWidth={1.75} />
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

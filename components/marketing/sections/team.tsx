import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, UsersRound } from 'lucide-react';
import founderPhoto from '@/public/img/team/polycap-wanyonyi.png';
import { FOUNDER_SOCIAL_LINKS, ROUTES } from '../routes';
import { SocialLinks } from '../social-links';

const teamPanel =
  'absolute inset-x-8 inset-y-0 flex flex-col items-center justify-between rounded-lg border border-brand-100 p-4 transition-colors duration-500 group-hover:border-brand-500 group-hover:bg-brand-500 sm:inset-x-12';

/**
 * Finanza's `.team-item`: the photo framed by a bordered panel that floods
 * primary on hover. Only the founder is named — see app/about/team/page.tsx
 * for why no one else is, until they have an approved bio and photo.
 */
export function FounderCard() {
  return (
    <div className="group relative py-16">
      <div className={teamPanel}>
        <div className="text-center">
          <p className="font-display text-xl font-semibold text-finanza-dark transition-colors duration-500 group-hover:text-white">
            Polycap Wanyonyi
          </p>
          <p className="text-sm text-finanza-text transition-colors duration-500 group-hover:text-white/85">
            Founder, Kitabu Yetu
          </p>
        </div>
        <SocialLinks variant="card" links={FOUNDER_SOCIAL_LINKS} className="relative z-10" />
      </div>
      <div className="relative z-2 mx-auto aspect-square w-full overflow-hidden rounded-lg bg-white">
        <Image
          src={founderPhoto}
          alt="Polycap Wanyonyi, Founder of Kitabu Yetu"
          fill
          sizes="(max-width: 767px) 90vw, (max-width: 1023px) 45vw, 30vw"
          className="object-cover object-top"
        />
      </div>
    </div>
  );
}

/** Stands where the template's second and third team members would be, pointing to real openings. */
export function JoinTeamCard() {
  return (
    <div className="group relative py-16">
      <div className={teamPanel}>
        <p className="font-display text-xl font-semibold text-finanza-dark transition-colors duration-500 group-hover:text-white">
          More profiles soon
        </p>
        <Link
          href={ROUTES.careers}
          className="relative z-10 inline-flex items-center gap-1.5 rounded-lg bg-brand-100 px-4 py-2 text-sm font-medium text-brand-500 transition-colors hover:bg-white focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          See open roles <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </Link>
      </div>
      <div className="relative z-2 flex aspect-square w-full flex-col items-center justify-center gap-4 rounded-lg bg-brand-50 p-8 text-center">
        <UsersRound aria-hidden="true" className="h-14 w-14 text-brand-500" />
        <p className="max-w-xs leading-relaxed text-finanza-text">
          Engineers, accountants and designers building in Nairobi, close to the groups we serve. Want to join them?
        </p>
      </div>
    </div>
  );
}

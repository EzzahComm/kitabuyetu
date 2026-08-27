import { Container, RevealedHeading, Section } from './primitives';
import { Reveal } from './reveal';

/**
 * Astrolus's blog block, scaffolded and empty.
 *
 * There is no CMS, no `content/` collection and no posts in this repository,
 * so this renders a placeholder rather than article cards. The theme's version
 * ships three fake posts with stock avatars; three cards linking nowhere is
 * the single most common way a marketing redesign ships dead links, and this
 * site's own routes.ts carries a note about a footer that once shipped ten of
 * them out of sixteen.
 *
 * TO FILL THIS IN: add posts (an `app/stories/[slug]` route or an MDX
 * collection), then replace the placeholder with the card grid sketched below.
 * Until then this section states plainly that stories are coming, which is
 * true, rather than implying a library that does not exist.
 */
export function StoriesSection() {
  return (
    <Section tone="paper" labelledBy="stories-heading">
      <Container>
        <RevealedHeading
          id="stories-heading"
          eyebrow="Stories"
          title="How groups are"
          emphasis="actually using it"
          trailing="."
          lede="Real groups, real books, in their own words — what changed when the records moved off paper."
        />

        {/*
          The real grid, for when posts exist:

          <ul className="mt-14 grid gap-6 md:grid-cols-3">
            {posts.map((post) => (
              <li key={post.slug}>
                <Link href={`/stories/${post.slug}`} className="group block ...">
                  <Image src={post.cover} alt="" ... />
                  <p className="font-mono text-[11px] uppercase ...">{post.group}</p>
                  <h3 className="...">{post.title}</h3>
                  <p className="...">{post.excerpt}</p>
                </Link>
              </li>
            ))}
          </ul>
        */}
        <Reveal className="mt-12">
          <div className="rounded-2xl border border-dashed border-brand-blue-900/15 bg-paper-deep px-6 py-12 text-center">
            <p className="mx-auto max-w-lg text-[0.9375rem] leading-relaxed text-brand-blue-900/60">
              We are writing these up with the groups themselves, so the numbers and the
              names are theirs to approve. The first stories land here shortly.
            </p>
            <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-brand-blue-900/45">
              Running a group that would like to be featured? Tell us about it.
            </p>
          </div>
        </Reveal>
      </Container>
    </Section>
  );
}

export default StoriesSection;

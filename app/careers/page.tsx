import type { Metadata } from 'next';
import { IconArrowUpRight, IconHeartHandshake, IconLeaf, IconUsersGroup } from '@tabler/icons-react';
import { Container } from '@/components/Container';
import { SectionTitle } from '@/components/SectionTitle';
import { SiteHeader } from '@/components/marketing/site-header';
import { SiteFooter } from '@/components/marketing/site-footer';
import { fraunces } from '@/components/marketing/fraunces-font';
import { CareersOpenings } from '@/components/marketing/careers-openings';
import { marketingMetadata } from '@/components/marketing/page-metadata';
import { getOpenJobs } from '@/lib/cms/sanity';

export const metadata: Metadata = marketingMetadata({
  path: '/careers',
  title: 'Careers',
  description: 'Help build practical financial tools for groups and organizations across East Africa.',
});

/**
 * Predates the marketing redesign and was missed when the rest of the site
 * moved to SiteHeader/SiteFooter — it shipped live with no navigation at all.
 * Wrapped here rather than ported into PageShell, since its layout is a
 * custom multi-section grid PageShell's prose container isn't built for.
 *
 * Open positions are Sanity-backed (kitabuyetu-studio's "job" type) — see
 * CareersOpenings for the filtering UI and app/careers/[slug] for the detail
 * page. Falls back to an honest "no open roles" state, same as before,
 * when the CMS has nothing published.
 */
export default async function CareersPage() {
  const jobs = await getOpenJobs();
  return (
    <div className={`${fraunces.variable} flex min-h-screen flex-col bg-white`}>
      <SiteHeader />
      <main id="main" className="flex-1 pt-16 lg:pt-20">
        <SectionTitle preTitle="Careers" title="Build the tools that help communities move forward" titleAs="h1">
          Kitabu Yetu gives the people running chamas, VSLAs and community organizations a clearer way to manage their
          members, money and next chapter.
        </SectionTitle>

        <Container className="mb-16">
          <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-3">
            <article className="border-t-2 border-indigo-600 pt-5">
              <IconHeartHandshake className="h-8 w-8 text-indigo-600" stroke={1.5} />
              <h2 className="mt-5 text-2xl font-bold text-gray-800 dark:text-white">Why work with us</h2>
              <p className="mt-3 leading-7 text-gray-500 dark:text-gray-300">
                Your work will be used by real groups making real decisions about their families, businesses and
                futures.
              </p>
            </article>

            <article className="border-t-2 border-green-600 pt-5">
              <IconLeaf className="h-8 w-8 text-green-600" stroke={1.5} />
              <h2 className="mt-5 text-2xl font-bold text-gray-800 dark:text-white">How we work</h2>
              <p className="mt-3 leading-7 text-gray-500 dark:text-gray-300">
                We listen closely, ship thoughtfully and stay accountable to the people whose records we help protect.
              </p>
            </article>

            <article className="border-t-2 border-amber-500 pt-5">
              <IconUsersGroup className="h-8 w-8 text-amber-600" stroke={1.5} />
              <h2 className="mt-5 text-2xl font-bold text-gray-800 dark:text-white">Who we need</h2>
              <p className="mt-3 leading-7 text-gray-500 dark:text-gray-300">
                Product thinkers, engineers, community listeners and operators who care about useful technology over
                noisy technology.
              </p>
            </article>
          </div>
        </Container>

        <section
          id="culture"
          className="border-y border-gray-200 bg-gray-50 dark:border-trueGray-800 dark:bg-trueGray-800/40"
        >
          <Container className="grid gap-10 py-16 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <p className="text-sm font-bold uppercase tracking-wider text-indigo-600">Our culture</p>
              <h2 className="mt-3 text-3xl font-bold leading-tight text-gray-800 dark:text-white">
                Serious about the work. Human about the people.
              </h2>
            </div>
            <div className="grid gap-8 sm:grid-cols-2">
              <div>
                <h3 className="text-lg font-bold text-gray-800 dark:text-white">Start with listening</h3>
                <p className="mt-2 leading-7 text-gray-500 dark:text-gray-300">
                  The best product decisions begin with the group, not the feature list.
                </p>
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-800 dark:text-white">Make trust visible</h3>
                <p className="mt-2 leading-7 text-gray-500 dark:text-gray-300">
                  Clear records, careful defaults and honest communication are part of the product.
                </p>
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-800 dark:text-white">Leave things better</h3>
                <p className="mt-2 leading-7 text-gray-500 dark:text-gray-300">
                  We improve the system, the process and the community around us as we go.
                </p>
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-800 dark:text-white">Keep learning</h3>
                <p className="mt-2 leading-7 text-gray-500 dark:text-gray-300">
                  Curiosity is practical here. Ask the next question and bring others along.
                </p>
              </div>
            </div>
          </Container>
        </section>

        <Container className="py-16">
          <div className="grid gap-10 lg:grid-cols-2">
            <div id="teams">
              <p className="text-sm font-bold uppercase tracking-wider text-indigo-600">Teams</p>
              <h2 className="mt-3 text-3xl font-bold text-gray-800 dark:text-white">
                Different skills, one useful product
              </h2>
              <p className="mt-4 leading-7 text-gray-500 dark:text-gray-300">
                Our work sits where community insight, product craft, technology and operations meet.
              </p>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {['Product and engineering', 'Community and operations', 'Partnerships', 'Customer experience'].map(
                  (team) => (
                    <div
                      key={team}
                      className="border-l-2 border-indigo-200 pl-4 text-sm font-semibold text-gray-700 dark:border-indigo-500/50 dark:text-gray-200"
                    >
                      {team}
                    </div>
                  ),
                )}
              </div>
            </div>
            <div id="benefits">
              <p className="text-sm font-bold uppercase tracking-wider text-indigo-600">Benefits</p>
              <h2 className="mt-3 text-3xl font-bold text-gray-800 dark:text-white">Room to do your best work</h2>
              <p className="mt-4 leading-7 text-gray-500 dark:text-gray-300">
                As the team grows, we are building practical support around the people doing the work.
              </p>
              <ul className="mt-6 grid gap-3 text-sm text-gray-700 dark:text-gray-200 sm:grid-cols-2">
                <li className="border-l-2 border-green-500 pl-4">Flexible, trust-based work</li>
                <li className="border-l-2 border-green-500 pl-4">Learning and development</li>
                <li className="border-l-2 border-green-500 pl-4">Meaningful community impact</li>
                <li className="border-l-2 border-green-500 pl-4">A voice in how we build</li>
              </ul>
            </div>
          </div>
        </Container>

        <Container className="py-16">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr]">
            <div>
              <p className="text-sm font-bold uppercase tracking-wider text-indigo-600">Open positions</p>
              <h2 className="mt-3 text-3xl font-bold text-gray-800 dark:text-white">Find your place here</h2>
              <p className="mt-4 max-w-lg leading-7 text-gray-500 dark:text-gray-300">
                We are keeping the team small while we get the fundamentals right. When a role opens, this is where you
                will find the work, the expectations and the application process.
              </p>
            </div>

            <CareersOpenings jobs={jobs} />
          </div>
        </Container>

        <section className="border-t border-gray-200 dark:border-trueGray-800">
          <Container className="flex flex-col items-start justify-between gap-6 py-12 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Bring your perspective</h2>
              <p className="mt-2 text-gray-500 dark:text-gray-300">
                Thoughtful introductions are welcome, even between openings.
              </p>
            </div>
            <a
              href="mailto:careers@kitabuyetu.co.ke"
              className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-5 py-3 font-semibold text-white hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
            >
              Email our team <IconArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </a>
          </Container>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

import type { Metadata } from "next";
import { IconArrowUpRight, IconHeartHandshake, IconLeaf, IconUsersGroup } from "@tabler/icons-react";
import { Container } from "@/components/Container";
import { SectionTitle } from "@/components/SectionTitle";

export const metadata: Metadata = {
  title: "Careers — Kitabu Yetu",
  description:
    "Help build practical financial tools for groups and organizations across East Africa.",
};

export default function CareersPage() {
  return (
    <>
      <SectionTitle
        preTitle="Careers"
        title="Build the tools that help communities move forward"
        titleAs="h1"
      >
        Kitabu Yetu gives the people running chamas, VSLAs and community
        organizations a clearer way to manage their members, money and next
        chapter.
      </SectionTitle>

      <Container className="mb-16">
        <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-3">
          <article className="border-t-2 border-indigo-600 pt-5">
            <IconHeartHandshake className="h-8 w-8 text-indigo-600" stroke={1.5} />
            <h2 className="mt-5 text-2xl font-bold text-gray-800 dark:text-white">Why work with us</h2>
            <p className="mt-3 leading-7 text-gray-500 dark:text-gray-300">
              Your work will be used by real groups making real decisions about
              their families, businesses and futures.
            </p>
          </article>

          <article className="border-t-2 border-green-600 pt-5">
            <IconLeaf className="h-8 w-8 text-green-600" stroke={1.5} />
            <h2 className="mt-5 text-2xl font-bold text-gray-800 dark:text-white">How we work</h2>
            <p className="mt-3 leading-7 text-gray-500 dark:text-gray-300">
              We listen closely, ship thoughtfully and stay accountable to the
              people whose records we help protect.
            </p>
          </article>

          <article className="border-t-2 border-amber-500 pt-5">
            <IconUsersGroup className="h-8 w-8 text-amber-600" stroke={1.5} />
            <h2 className="mt-5 text-2xl font-bold text-gray-800 dark:text-white">Who we need</h2>
            <p className="mt-3 leading-7 text-gray-500 dark:text-gray-300">
              Product thinkers, engineers, community listeners and operators
              who care about useful technology over noisy technology.
            </p>
          </article>
        </div>
      </Container>

      <section id="culture" className="border-y border-gray-200 bg-gray-50 dark:border-trueGray-800 dark:bg-trueGray-800/40">
        <Container className="grid gap-10 py-16 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="text-sm font-bold uppercase tracking-wider text-indigo-600">Our culture</p>
            <h2 className="mt-3 text-3xl font-bold leading-tight text-gray-800 dark:text-white">Serious about the work. Human about the people.</h2>
          </div>
          <div className="grid gap-8 sm:grid-cols-2">
            <div>
              <h3 className="text-lg font-bold text-gray-800 dark:text-white">Start with listening</h3>
              <p className="mt-2 leading-7 text-gray-500 dark:text-gray-300">The best product decisions begin with the group, not the feature list.</p>
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-800 dark:text-white">Make trust visible</h3>
              <p className="mt-2 leading-7 text-gray-500 dark:text-gray-300">Clear records, careful defaults and honest communication are part of the product.</p>
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-800 dark:text-white">Leave things better</h3>
              <p className="mt-2 leading-7 text-gray-500 dark:text-gray-300">We improve the system, the process and the community around us as we go.</p>
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-800 dark:text-white">Keep learning</h3>
              <p className="mt-2 leading-7 text-gray-500 dark:text-gray-300">Curiosity is practical here. Ask the next question and bring others along.</p>
            </div>
          </div>
        </Container>
      </section>

      <Container className="py-16">
        <div className="grid gap-10 lg:grid-cols-2">
          <div id="teams">
            <p className="text-sm font-bold uppercase tracking-wider text-indigo-600">Teams</p>
            <h2 className="mt-3 text-3xl font-bold text-gray-800 dark:text-white">Different skills, one useful product</h2>
            <p className="mt-4 leading-7 text-gray-500 dark:text-gray-300">Our work sits where community insight, product craft, technology and operations meet.</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {['Product and engineering', 'Community and operations', 'Partnerships', 'Customer experience'].map((team) => (
                <div key={team} className="border-l-2 border-indigo-200 pl-4 text-sm font-semibold text-gray-700 dark:border-indigo-500/50 dark:text-gray-200">{team}</div>
              ))}
            </div>
          </div>
          <div id="benefits">
            <p className="text-sm font-bold uppercase tracking-wider text-indigo-600">Benefits</p>
            <h2 className="mt-3 text-3xl font-bold text-gray-800 dark:text-white">Room to do your best work</h2>
            <p className="mt-4 leading-7 text-gray-500 dark:text-gray-300">As the team grows, we are building practical support around the people doing the work.</p>
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
              We are keeping the team small while we get the fundamentals right.
              When a role opens, this is where you will find the work, the
              expectations and the application process.
            </p>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-trueGray-700 dark:bg-trueGray-900">
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                Search jobs
                <input aria-label="Search jobs" type="search" placeholder="Search roles" className="mt-2 w-full rounded-md border border-gray-300 bg-transparent px-3 py-2 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-trueGray-600" />
              </label>
              <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                Department
                <select aria-label="Filter by department" className="mt-2 w-full rounded-md border border-gray-300 bg-transparent px-3 py-2 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-trueGray-600">
                  <option>All departments</option>
                  <option>Product and engineering</option>
                  <option>Community and operations</option>
                </select>
              </label>
              <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                Location
                <select aria-label="Filter by location" className="mt-2 w-full rounded-md border border-gray-300 bg-transparent px-3 py-2 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-trueGray-600">
                  <option>All locations</option>
                  <option>Kenya</option>
                  <option>Remote</option>
                </select>
              </label>
            </div>
            <div className="mt-8 border-t border-gray-200 pt-8 text-center dark:border-trueGray-700">
              <h3 className="text-xl font-bold text-gray-800 dark:text-white">No open roles right now</h3>
              <p className="mx-auto mt-3 max-w-md leading-7 text-gray-500 dark:text-gray-300">We do not have a published vacancy that matches these filters today. We would still like to hear from people who understand this work.</p>
              <a href="mailto:careers@kitabuyetu.co.ke" className="mt-5 inline-flex items-center gap-2 font-semibold text-indigo-600 hover:text-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300">
                Introduce yourself <IconArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>
          </div>
        </div>
      </Container>

      <section className="border-t border-gray-200 dark:border-trueGray-800">
        <Container className="flex flex-col items-start justify-between gap-6 py-12 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Bring your perspective</h2>
            <p className="mt-2 text-gray-500 dark:text-gray-300">Thoughtful introductions are welcome, even between openings.</p>
          </div>
          <a href="mailto:careers@kitabuyetu.co.ke" className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-5 py-3 font-semibold text-white hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300">
            Email our team <IconArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </a>
        </Container>
      </section>
    </>
  );
}
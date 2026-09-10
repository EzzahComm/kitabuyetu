"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AnimatePresence,
  LazyMotion,
  domAnimation,
  m,
  useReducedMotion,
} from "framer-motion";
import { Container } from "@/components/Container";
import { signUpUrl } from "@/lib/app-links";
import bookkeeperImg from "../../public/img/bookkeeper.jpg";
import chamaReminderImg from "../../public/img/chama-reminder.jpg";
import fundraiseImg from "../../public/img/fundraise.jpg";
import enterpriseImg from "../../public/img/enterprise.jpg";

/**
 * The four product pillars rotate through the home hero so the platform is
 * immediately legible as an ecosystem, not a generic bookkeeping product.
 *
 * Images are real photos, licensed for commercial use with no attribution
 * required — kept here for provenance:
 * Product photography sources are recorded in public/img/IMAGE_SOURCES.md.
 */
const HERO_MESSAGES = [
  {
    id: "bookkeeper",
    product: "Bookkeeper",
    title: "Keep the whole group book in one place.",
    subtitle:
      "Members, contributions, savings, loans, welfare and M-Pesa on one reliable record.",
    image: bookkeeperImg,
    imageAlt: "A group of women meeting together, laughing and talking",
  },
  {
    id: "chama-reminder",
    product: "Chama Reminder",
    title: "Keep every member in the conversation.",
    subtitle:
      "Send contribution reminders, meeting notices and updates by SMS, without rebuilding your list.",
    image: chamaReminderImg,
    imageAlt: "A woman smiling while checking her phone",
  },
  {
    id: "fundraise",
    product: "Fundraise / Changi$ha",
    title: "Turn a shared idea into a funded project.",
    subtitle:
      "Create a campaign, track every contribution and keep project money separate from ordinary group funds.",
    image: fundraiseImg,
    imageAlt: "Community members meeting around a shared project",
  },
  {
    id: "enterprise",
    product: "Enterprise",
    title: "See the portfolio. Support every group.",
    subtitle:
      "Give organizations one accountable view across programmes, groups, members and financial activity.",
    image: enterpriseImg,
    imageAlt: "A community leader reviewing information on a phone",
  },
] as const;

const ROTATION_MS = 3500;

export const Hero = () => {
  const [index, setIndex] = useState(0);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    // Respect prefers-reduced-motion: leave the first message on screen
    // instead of auto-rotating.
    if (prefersReducedMotion) return;

    let timer: ReturnType<typeof setInterval> | undefined;

    const start = () => {
      timer = setInterval(() => {
        setIndex((prev) => (prev + 1) % HERO_MESSAGES.length);
      }, ROTATION_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    };

    // Don't burn CPU/battery animating a rotation nobody can see.
    const handleVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    start();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [prefersReducedMotion]);

  const current = HERO_MESSAGES[index];

  return (
    <LazyMotion features={domAnimation}>
      <Container className="grid items-center gap-10 py-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:py-20">
        <div className="flex items-center">
          <div className="max-w-2xl">
            {/* Both slides share this grid cell so the taller of the two
                sets the box size during the crossfade — no fixed height,
                no layout jump once the shorter one settles in. */}
            <div className="grid">
              <AnimatePresence>
                <m.div
                  key={current.id}
                  initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: prefersReducedMotion ? 0 : -20 }}
                  transition={{ duration: 0.5, ease: "easeInOut" }}
                  className="col-start-1 row-start-1">
                  <p className="mb-3 text-sm font-bold uppercase tracking-wider text-brand-600">{current.product}</p>
                  <h1 className="text-4xl font-bold leading-tight tracking-tight text-brand-blue-900 lg:text-5xl lg:leading-tight xl:text-6xl dark:text-white">
                    {current.title}
                  </h1>
                  <p className="max-w-xl pt-5 text-xl font-medium leading-8 text-brand-blue-900/85 dark:text-gray-200">
                    {current.subtitle}
                  </p>
                </m.div>
              </AnimatePresence>
            </div>

            <p className="max-w-xl py-5 text-lg leading-8 text-gray-600 dark:text-gray-300">
              Kitabu Yetu helps chamas, VSLAs, welfare groups, cooperatives and
              community organizations manage themselves, grow their track record
              and access useful opportunities.
            </p>

            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              <a
                href={signUpUrl()}
                className="inline-flex min-h-12 items-center justify-center rounded-md bg-brand-600 px-8 py-4 text-lg font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500">
                Get Started
              </a>
              <Link
                href="/contact"
                className="inline-flex min-h-12 items-center justify-center rounded-md border border-brand-600 px-8 py-4 text-lg font-semibold text-brand-700 transition-colors hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-brand-400 dark:text-brand-300 dark:hover:bg-trueGray-800">
                Talk to Us
              </Link>
            </div>

            <p className="mt-6 text-gray-500 dark:text-gray-400">
              Simple to start · M-Pesa integrated · Secure · Built for Kenyan
              groups
            </p>
            <p className="mt-1 font-medium text-gray-600 dark:text-gray-300">
              From KES 150/month · Pay by M-Pesa
            </p>
          </div>
        </div>
        <div className="flex items-center justify-center">
          <div className="grid w-full max-w-xl overflow-hidden rounded-md bg-brand-50 shadow-sm dark:bg-trueGray-800">
            <AnimatePresence>
              <m.div
                key={current.id}
                initial={{ opacity: 0, x: prefersReducedMotion ? 0 : 40 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: prefersReducedMotion ? 0 : -40 }}
                transition={{ duration: 0.6, ease: [0.32, 0.94, 0.6, 1] }}
                  className="col-start-1 row-start-1 aspect-[4/3]">
                <Image
                  src={current.image}
                  width={current.image.width}
                  height={current.image.height}
                  className="h-full w-full object-cover"
                  sizes="(max-width: 1023px) 100vw, 48vw"
                  alt={current.imageAlt}
                  loading="eager"
                  placeholder="blur"
                />
              </m.div>
            </AnimatePresence>
          </div>
        </div>
      </Container>

      <Container className="mb-20 pt-0">
        <div className="flex flex-col justify-center">
          <div className="text-xl text-center text-gray-700 dark:text-white">
            Built for Kenyan groups, on{" "}
            <span className="text-indigo-600">Kenyan rails</span>
          </div>

          <p className="max-w-2xl mx-auto mt-5 text-center text-gray-500 dark:text-gray-400">
            Partner and customer logos go here once we have permission to show
            them. We would rather leave this empty than fill it with names that
            have not agreed to appear.
          </p>
        </div>
      </Container>
    </LazyMotion>
  );
};

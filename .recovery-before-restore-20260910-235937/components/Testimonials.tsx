import React from "react";
import { Container } from "@/components/Container";

const testimonials = [
  {
    quote:
      "Kitabu Yetu has been a game changer for accountability and transparency in our group.",
    mark: "game changer",
    name: "Ezra Wekesa",
    title: "Coordinator, Munyali Ukulima Self Help Group",
  },
  {
    quote:
      "It has made mobilizing our members much easier and managing the group more efficient.",
    mark: "much easier",
    name: "Bernard Kisaka",
    title: "Musikoma Home Owners Welfare Association",
  },
  {
    quote: "Manually updating contributions is a thing of the past.",
    mark: "a thing of the past",
    name: "Britney Mideva",
    title: "Treasurer, The Fionas",
  },
  {
    quote:
      "Meeting attendance has improved and timely contributions are becoming the norm.",
    mark: "becoming the norm",
    name: "Joseph Bienda",
    title: "Chairperson, Capital Point Chama",
  },
];

/**
 * Testimonials as a continuously sliding strip. The track carries the list
 * twice — the second copy is aria-hidden so it isn't announced twice — and
 * animates to -50%, which is exactly the width of one copy, so it loops
 * seamlessly. Pauses on hover and on keyboard focus; under
 * prefers-reduced-motion the animation stops and the strip becomes an ordinary
 * horizontal scroll region instead.
 */
export const Testimonials = () => {
  return (
    <Container className="mb-20">
      <div className="relative overflow-hidden group motion-reduce:overflow-x-auto">
        <div className="flex w-max gap-8 animate-marquee group-hover:[animation-play-state:paused] focus-within:[animation-play-state:paused] motion-reduce:animate-none">
          {testimonials.map((item) => (
            <Card key={item.name} item={item} />
          ))}
          {testimonials.map((item) => (
            <Card key={`${item.name}-duplicate`} item={item} ariaHidden />
          ))}
        </div>
      </div>
    </Container>
  );
};

interface Item {
  quote: string;
  mark: string;
  name: string;
  title: string;
}

function Card({ item, ariaHidden }: { item: Item; ariaHidden?: boolean }) {
  return (
    <figure
      aria-hidden={ariaHidden}
      className="flex flex-col justify-between flex-shrink-0 w-80 p-10 bg-gray-100 sm:w-96 rounded-2xl dark:bg-trueGray-800"
    >
      <blockquote className="text-xl leading-normal">
        {quoteWithMark(item.quote, item.mark)}
      </blockquote>
      <figcaption>
        <Avatar name={item.name} title={item.title} />
      </figcaption>
    </figure>
  );
}

/** Splits a quote around `mark` and wraps that phrase in <Mark>, so the highlight is data-driven rather than hand-split JSX per testimonial. */
function quoteWithMark(quote: string, mark: string) {
  const i = quote.indexOf(mark);
  if (i === -1) return quote;
  return (
    <>
      {quote.slice(0, i)}
      <Mark>{mark}</Mark>
      {quote.slice(i + mark.length)}
    </>
  );
}

interface AvatarProps {
  name: string;
  title: string;
}

function Avatar(props: Readonly<AvatarProps>) {
  const initials = props.name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex items-center mt-8 space-x-3">
      <div className="flex items-center justify-center flex-shrink-0 text-lg font-medium text-indigo-800 bg-indigo-100 rounded-full w-14 h-14 dark:bg-indigo-900 dark:text-indigo-200">
        {initials}
      </div>
      <div>
        <div className="text-lg font-medium">{props.name}</div>
        <div className="text-sm text-gray-600 dark:text-gray-400">
          {props.title}
        </div>
      </div>
    </div>
  );
}

function Mark(props: { readonly children: React.ReactNode }) {
  return (
    <mark className="text-indigo-800 bg-indigo-100 rounded-md ring-indigo-100 ring-4 dark:ring-indigo-900 dark:bg-indigo-900 dark:text-indigo-200">
      {props.children}
    </mark>
  );
}

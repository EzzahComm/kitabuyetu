import React from 'react';
import { Container } from '@/components/Container';
import { Pill } from '@/components/marketing/finanza';

interface SectionTitleProps {
  preTitle?: string;
  title?: string;
  align?: 'left' | 'center';
  /** Render the title as <h1> instead of <h2> - use on the first heading of a page that has no <h1> of its own. */
  titleAs?: 'h1' | 'h2';
  children?: React.ReactNode;
}

/** Pill + heading + lede, in the Finanza template's style. */
export const SectionTitle = (props: Readonly<SectionTitleProps>) => {
  const TitleTag = props.titleAs ?? 'h2';
  return (
    <Container
      className={`flex w-full flex-col ${props.align === 'left' ? '' : 'items-center justify-center text-center'}`}
    >
      {props.preTitle && <Pill>{props.preTitle}</Pill>}

      {props.title && (
        <TitleTag className="max-w-3xl font-display text-[2rem] font-bold leading-[1.15] text-finanza-dark sm:text-[2.5rem] xl:text-5xl">
          {props.title}
        </TitleTag>
      )}

      {props.children && <p className="max-w-2xl py-4 text-lg leading-relaxed text-finanza-text">{props.children}</p>}
    </Container>
  );
};

import Image from 'next/image';
import Link from 'next/link';
import React from 'react';
import type { StaticImageData } from 'next/image';
import { Container } from '@/components/Container';
import { btnPrimary } from '@/components/marketing/finanza';

interface BenefitsProps {
  imgPos?: 'left' | 'right';
  data: {
    imgPos?: 'left' | 'right';
    title: string;
    desc: string;
    image: StaticImageData;
    /** Describes the photo itself; the title is already rendered as the adjacent heading. */
    imageAlt: string;
    bullets: {
      title: string;
      desc: string;
      /** Cloned to inject sizing classes, so it must be an element, not any node. */
      icon: React.ReactElement;
    }[];
    /** Optional CTA shown once the section has made its case. Omit to render no button. */
    cta?: {
      text: string;
      href: string;
    };
  };
}

/** Image beside a heading and icon-circle list — the Finanza about block's feature items. */
export const Benefits = (props: Readonly<BenefitsProps>) => {
  const { data } = props;
  return (
    <Container className="mb-20 flex flex-wrap gap-y-10 lg:flex-nowrap lg:gap-16">
      <div
        className={`flex w-full items-center justify-center lg:w-1/2 ${props.imgPos === 'right' ? 'lg:order-1' : ''}`}
      >
        <Image
          src={data.image}
          width={521}
          height={521}
          alt={data.imageAlt}
          className="aspect-[4/3] w-full rounded-lg object-cover"
          placeholder="blur"
        />
      </div>

      <div className={`flex w-full flex-wrap items-center lg:w-1/2 ${data.imgPos === 'right' ? 'lg:justify-end' : ''}`}>
        <div>
          <h3 className="max-w-2xl font-display text-[2rem] font-bold leading-[1.15] text-finanza-dark lg:text-[2.5rem]">
            {data.title}
          </h3>
          <p className="max-w-2xl py-4 text-lg leading-relaxed text-finanza-text">{data.desc}</p>

          <div className="mt-2 w-full">
            {data.bullets.map((item, index) => (
              <Benefit key={index} title={item.title} icon={item.icon}>
                {item.desc}
              </Benefit>
            ))}
          </div>

          {data.cta && (
            <div className="mt-8 w-full">
              <Link href={data.cta.href} className={btnPrimary}>
                {data.cta.text}
              </Link>
            </div>
          )}
        </div>
      </div>
    </Container>
  );
};

interface BenefitProps {
  icon: React.ReactElement;
  title: string;
  children: React.ReactNode;
}

function Benefit(props: BenefitProps) {
  return (
    <div className="mt-6 flex items-start gap-4">
      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-brand-500">
        {React.cloneElement(props.icon, {
          className: 'h-5 w-5 text-white',
        })}
      </div>
      <div>
        <h4 className="font-display text-xl font-semibold text-finanza-dark">{props.title}</h4>
        <p className="mt-1 text-finanza-text">{props.children}</p>
      </div>
    </div>
  );
}

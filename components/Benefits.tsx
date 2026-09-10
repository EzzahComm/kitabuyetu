import Image from "next/image";
import Link from "next/link";
import React from "react";
import { Container }  from "@/components/Container";

interface BenefitsProps {
  imgPos?: "left" | "right";
  data: {
    imgPos?: "left" | "right";
    title: string;
    desc: string;
    image: any;
    bullets: {
      title: string;
      desc: string;
      icon: React.ReactNode;
    }[];
    /** Optional CTA shown once the section has made its case. Omit to render no button. */
    cta?: {
      text: string;
      href: string;
    };
  };
}
export const Benefits = (props: Readonly<BenefitsProps>) => {
  const { data } = props;
  return (
      <Container className="mb-20 flex flex-wrap gap-y-10 lg:flex-nowrap lg:gap-16">
        <div
          className={`flex items-center justify-center w-full lg:w-1/2 ${
            props.imgPos === "right" ? "lg:order-1" : ""
          }`}>
          <div>
            <Image
              src={data.image}
              width={521}
              height={521}
              alt={data.title}
              className={"object-cover"}
              placeholder="blur"
              blurDataURL={data.image.src}
            />
          </div>
        </div>

        <div
          className={`flex flex-wrap items-center w-full lg:w-1/2 ${
            data.imgPos === "right" ? "lg:justify-end" : ""
          }`}>
          <div>
              <div className="mt-4 flex w-full flex-col">
              <h3 className="max-w-2xl text-3xl font-bold leading-tight tracking-tight text-brand-blue-900 lg:text-4xl dark:text-white">
                {data.title}
              </h3>

              <p className="max-w-2xl py-4 text-lg leading-8 text-gray-600 dark:text-gray-300">
                {data.desc}
              </p>
            </div>

            <div className="w-full mt-5">
              {data.bullets.map((item, index) => (
                <Benefit key={index} title={item.title} icon={item.icon}>
                  {item.desc}
                </Benefit>
              ))}
            </div>

            {data.cta && (
              <div className="w-full mt-8">
                <Link
                  href={data.cta.href}
                  className="inline-flex min-h-12 items-center justify-center rounded-md bg-brand-600 px-6 py-3 text-lg font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500">
                  {data.cta.text}
                </Link>
              </div>
            )}
          </div>
        </div>
      </Container>
  );
};

function Benefit(props: any) {
  return (
      <div className="mt-8 flex items-start gap-3">
        <div className="mt-1 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md bg-brand-600">
          {React.cloneElement(props.icon, {
            className: "h-6 w-6 text-brand-50",
          })}
        </div>
        <div>
          <h4 className="text-xl font-medium text-gray-800 dark:text-gray-200">
            {props.title}
          </h4>
          <p className="mt-1 text-gray-500 dark:text-gray-400">
            {props.children}
          </p>
        </div>
      </div>
  );
}

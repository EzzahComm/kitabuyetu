import Image from "next/image";
import { ArrowRightIcon } from "@heroicons/react/24/solid";
import { Container } from "./Container";
import heroImg from "../../../public/img/hero.png";

export const Hero = () => {
  return (
    <>
      <Container className="flex flex-wrap ">
        <div className="flex items-center w-full lg:w-1/2">
          <div className="max-w-2xl mb-8">
            <h1 className="text-4xl font-bold leading-snug tracking-tight text-gray-800 lg:text-4xl lg:leading-tight xl:text-6xl xl:leading-tight dark:text-white">
              Simple tools. Stronger groups. Vibrant communities.
            </h1>
            <p className="py-5 text-xl leading-normal text-gray-500 lg:text-xl xl:text-2xl dark:text-gray-300">
              One simple place for chamas, welfare groups, SACCOs, investment
              clubs and community organizations to manage members, savings,
              loans, payments and records — with Enterprise for the
              organizations that support many groups at once.
            </p>

            <div className="flex flex-col items-start space-y-3 sm:space-x-4 sm:space-y-0 sm:items-center sm:flex-row">
              <a
                href="/contact"
                className="px-8 py-4 text-lg font-medium text-center text-white bg-indigo-600 rounded-md ">
                Get started
              </a>
              <a
                href="/enterprise"
                className="flex items-center space-x-2 text-gray-500 dark:text-gray-400">
                <ArrowRightIcon className="w-6 h-6" />
                <span>Explore Enterprise</span>
              </a>
            </div>

            <p className="mt-6 text-gray-500 dark:text-gray-400">
              Simple to start · Real-time visibility · Secure role-based access
            </p>
            <p className="mt-1 text-gray-500 dark:text-gray-400">
              Pay by M-Pesa · plans from KES 150/month
            </p>
          </div>
        </div>
        <div className="flex items-center justify-center w-full lg:w-1/2">
          <div className="">
            <Image
              src={heroImg}
              width="616"
              height="617"
              className={"object-cover"}
              alt="Hero Illustration"
              loading="eager"
              placeholder="blur"
            />
          </div>
        </div>
      </Container>
      <Container>
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
    </>
  );
}

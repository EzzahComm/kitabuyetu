"use client";
import React from "react";
import { IconArrowUp } from "@tabler/icons-react";

/**
 * Scroll-to-top control. Sits above the contact widget in the bottom-right
 * corner and only appears once there's meaningfully far to scroll back.
 */
export function BackToTop() {
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const onScroll = () => {
      const shouldShow = window.scrollY > 600;
      // Only touch state on an actual change, so this isn't re-rendering on
      // every scroll event.
      setVisible((current) => (current === shouldShow ? current : shouldShow));
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToTop = () => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    window.scrollTo({ top: 0, behavior: prefersReducedMotion ? "auto" : "smooth" });
  };

  return (
    <button
      type="button"
      onClick={scrollToTop}
      aria-label="Back to top"
      // Kept out of the tab order and off screen readers while hidden, so it
      // can't be focused as an invisible target.
      tabIndex={visible ? 0 : -1}
      aria-hidden={!visible}
      className={`fixed z-40 flex items-center justify-center w-12 h-12 text-gray-600 transition-opacity duration-200 bg-white border border-gray-300 rounded-full shadow-lg right-5 bottom-24 hover:text-indigo-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 dark:bg-trueGray-800 dark:border-trueGray-700 dark:text-gray-300 ${
        visible ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
    >
      <IconArrowUp size={20} />
    </button>
  );
}

export default BackToTop;

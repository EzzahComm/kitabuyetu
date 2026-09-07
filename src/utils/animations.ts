/**
 * Animation utilities
 * Smooth transitions and micro-interactions
 */

/**
 * Animation configuration
 */
export const animations = {
  // Duration (ms)
  duration: {
    fast: 150,
    normal: 200,
    slow: 300,
  },

  // Easing functions
  easing: {
    easeIn: "cubic-bezier(0.4, 0, 1, 1)",
    easeOut: "cubic-bezier(0, 0, 0.2, 1)",
    easeInOut: "cubic-bezier(0.4, 0, 0.2, 1)",
    easeOutElastic: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  },
};

/**
 * Tailwind animation classes
 * Add to your tailwind config for custom animations
 */
export const animationClasses = {
  // Fade animations
  fadeIn: "animate-fade-in",
  fadeOut: "animate-fade-out",

  // Slide animations
  slideInFromTop: "animate-slide-in-from-top",
  slideInFromBottom: "animate-slide-in-from-bottom",
  slideInFromLeft: "animate-slide-in-from-left",
  slideInFromRight: "animate-slide-in-from-right",

  // Scale animations
  scaleIn: "animate-scale-in",
  scaleOut: "animate-scale-out",

  // Pulse
  pulse: "animate-pulse",
  bounce: "animate-bounce",
};

/**
 * CSS animation keyframes for tailwind.config.ts
 */
export const animationKeyframes = {
  "fade-in": {
    "0%": { opacity: "0" },
    "100%": { opacity: "1" },
  },
  "fade-out": {
    "0%": { opacity: "1" },
    "100%": { opacity: "0" },
  },
  "slide-in-from-top": {
    "0%": { opacity: "0", transform: "translateY(-10px)" },
    "100%": { opacity: "1", transform: "translateY(0)" },
  },
  "slide-in-from-bottom": {
    "0%": { opacity: "0", transform: "translateY(10px)" },
    "100%": { opacity: "1", transform: "translateY(0)" },
  },
  "slide-in-from-left": {
    "0%": { opacity: "0", transform: "translateX(-10px)" },
    "100%": { opacity: "1", transform: "translateX(0)" },
  },
  "slide-in-from-right": {
    "0%": { opacity: "0", transform: "translateX(10px)" },
    "100%": { opacity: "1", transform: "translateX(0)" },
  },
  "scale-in": {
    "0%": { opacity: "0", transform: "scale(0.95)" },
    "100%": { opacity: "1", transform: "scale(1)" },
  },
  "scale-out": {
    "0%": { opacity: "1", transform: "scale(1)" },
    "100%": { opacity: "0", transform: "scale(0.95)" },
  },
};

/**
 * Transition utilities
 */
export const transitions = {
  // Fast transitions for micro-interactions
  fast: `transition-all ${animations.duration.fast}ms ${animations.easing.easeOut}`,

  // Normal transitions
  normal: `transition-all ${animations.duration.normal}ms ${animations.easing.easeOut}`,

  // Slow transitions for important state changes
  slow: `transition-all ${animations.duration.slow}ms ${animations.easing.easeOut}`,

  // Color transitions
  colors: `transition-colors ${animations.duration.normal}ms ${animations.easing.easeOut}`,

  // Transform transitions (for scale, rotate, translate)
  transform: `transition-transform ${animations.duration.normal}ms ${animations.easing.easeOut}`,

  // Opacity transitions
  opacity: `transition-opacity ${animations.duration.normal}ms ${animations.easing.easeOut}`,
};

/**
 * Animate element with GSAP-like syntax
 * Uses CSS animations for better performance
 */
export function animate(
  element: HTMLElement,
  keyframes: Record<string, string>,
  options: {
    duration?: number;
    delay?: number;
    easing?: string;
    onComplete?: () => void;
  } = {}
): void {
  const {
    duration = 300,
    delay = 0,
    easing = animations.easing.easeOut,
    onComplete,
  } = options;

  // Create animation
  const animationName = `animation-${Math.random().toString(36).slice(2)}`;
  const keyframeString = Object.entries(keyframes)
    .map(([key, value]) => `${key} { ${value} }`)
    .join(" ");

  const style = document.createElement("style");
  style.innerHTML = `
    @keyframes ${animationName} {
      ${keyframeString}
    }
  `;
  document.head.appendChild(style);

  // Apply animation
  element.style.animation = `${animationName} ${duration}ms ${easing} ${delay}ms forwards`;

  // Cleanup
  setTimeout(() => {
    element.style.animation = "";
    style.remove();
    onComplete?.();
  }, duration + delay);
}

/**
 * Stagger animation for multiple elements
 */
export function staggerAnimate(
  elements: HTMLElement[],
  keyframes: Record<string, string>,
  options: {
    duration?: number;
    stagger?: number;
    easing?: string;
  } = {}
): void {
  const { stagger = 50 } = options;

  elements.forEach((element, index) => {
    animate(element, keyframes, {
      ...options,
      delay: index * stagger,
    });
  });
}

/**
 * Spring animation helper
 * Creates bouncy effect
 */
export function springAnimate(
  element: HTMLElement,
  property: "scale" | "translateX" | "translateY" = "scale"
): void {
  const keyframes: Record<string, string> = {
    "0%": `transform: ${property}(0.8)`,
    "50%": `transform: ${property}(1.05)`,
    "100%": `transform: ${property}(1)`,
  };

  animate(element, keyframes, {
    duration: 400,
    easing: animations.easing.easeOutElastic,
  });
}

/**
 * Shake animation
 */
export function shakeAnimate(element: HTMLElement): void {
  const keyframes: Record<string, string> = {
    "0%": "transform: translateX(0)",
    "10%": "transform: translateX(-5px)",
    "20%": "transform: translateX(5px)",
    "30%": "transform: translateX(-5px)",
    "40%": "transform: translateX(5px)",
    "50%": "transform: translateX(-5px)",
    "60%": "transform: translateX(5px)",
    "70%": "transform: translateX(-5px)",
    "80%": "transform: translateX(5px)",
    "90%": "transform: translateX(-5px)",
    "100%": "transform: translateX(0)",
  };

  animate(element, keyframes, { duration: 500 });
}

/**
 * Pulse animation
 */
export function pulseAnimate(element: HTMLElement, duration = 2000): void {
  const keyframes: Record<string, string> = {
    "0%": "opacity: 1",
    "50%": "opacity: 0.5",
    "100%": "opacity: 1",
  };

  animate(element, keyframes, {
    duration,
    onComplete: () => {
      // Loop animation
      pulseAnimate(element, duration);
    },
  });
}

/**
 * Usage examples:
 *
 * // Animate element
 * const element = document.getElementById('box');
 * animate(element, {
 *   '0%': 'opacity: 0; transform: translateY(-20px)',
 *   '100%': 'opacity: 1; transform: translateY(0)'
 * }, { duration: 300 });
 *
 * // Stagger animation
 * const items = document.querySelectorAll('.item');
 * staggerAnimate(Array.from(items), {
 *   '0%': 'opacity: 0',
 *   '100%': 'opacity: 1'
 * }, { stagger: 100 });
 *
 * // Spring animation
 * springAnimate(element, 'scale');
 *
 * // Shake animation
 * shakeAnimate(element);
 */

/**
 * Performance utilities
 * Optimization helpers and monitoring
 */

/**
 * Debounce function
 * Delays function execution until after N milliseconds of inactivity
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number = 300
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      timeout = null;
      func(...args);
    };

    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(later, wait);
  };
}

/**
 * Throttle function
 * Limits function execution to once every N milliseconds
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number = 300
): (...args: Parameters<T>) => void {
  let lastFunc: NodeJS.Timeout | null = null;
  let lastRan: number | null = null;

  return function executedFunction(...args: Parameters<T>) {
    if (!lastRan) {
      func(...args);
      lastRan = Date.now();
    } else {
      if (lastFunc) {
        clearTimeout(lastFunc);
      }
      lastFunc = setTimeout(() => {
        if (Date.now() - (lastRan || 0) >= limit) {
          func(...args);
          lastRan = Date.now();
        }
      }, limit - (Date.now() - (lastRan || 0)));
    }
  };
}

/**
 * Memoize function results
 * Caches function results based on arguments
 */
export function memoize<T extends (...args: any[]) => any>(func: T): T {
  const cache = new Map();

  return function memoized(...args: Parameters<T>) {
    const key = JSON.stringify(args);

    if (cache.has(key)) {
      return cache.get(key);
    }

    const result = func(...args);
    cache.set(key, result);
    return result;
  } as T;
}

/**
 * Request idle callback polyfill
 * Schedules callback to run when browser is idle
 */
export function scheduleIdleTask(callback: () => void): void {
  if ('requestIdleCallback' in window) {
    (window as any).requestIdleCallback(callback);
  } else {
    setTimeout(callback, 1);
  }
}

/**
 * Measure performance
 * Logs execution time of a function
 */
export function measurePerformance<T extends (...args: any[]) => any>(
  func: T,
  label: string = func.name
): T {
  return function measured(...args: Parameters<T>) {
    const start = performance.now();
    const result = func(...args);
    const end = performance.now();

    console.log(`[Performance] ${label} took ${(end - start).toFixed(2)}ms`);
    return result;
  } as T;
}

/**
 * Batch updates
 * Groups multiple state updates into single render
 */
export function batchUpdates(callback: () => void): void {
  // React 18+ uses automatic batching, but this can be useful
  // for grouping other operations
  callback();
}

/**
 * Lazy load image
 * Loads image only when in viewport
 */
export function lazyLoadImage(
  selector: string,
  callback?: () => void
): void {
  if ('IntersectionObserver' in window) {
    const images = document.querySelectorAll(selector);
    const imageObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const img = entry.target as HTMLImageElement;
          img.src = img.dataset.src || '';
          img.classList.remove('lazy');
          imageObserver.unobserve(img);
          callback?.();
        }
      });
    });

    images.forEach((img) => imageObserver.observe(img));
  }
}

/**
 * Performance metrics
 */
export interface PerformanceMetrics {
  fcp: number | null; // First Contentful Paint
  lcp: number | null; // Largest Contentful Paint
  fid: number | null; // First Input Delay
  cls: number | null; // Cumulative Layout Shift
  ttfb: number | null; // Time to First Byte
}

/**
 * Get performance metrics
 * Returns Web Vitals metrics
 */
export function getPerformanceMetrics(): PerformanceMetrics {
  const metrics: PerformanceMetrics = {
    fcp: null,
    lcp: null,
    fid: null,
    cls: null,
    ttfb: null,
  };

  // FCP
  const fcpEntries = performance.getEntriesByName('first-contentful-paint');
  if (fcpEntries.length > 0) {
    metrics.fcp = fcpEntries[0].startTime;
  }

  // TTFB
  const navigationEntries = performance.getEntriesByType('navigation');
  if (navigationEntries.length > 0) {
    const navigationEntry = navigationEntries[0] as PerformanceNavigationTiming;
    metrics.ttfb = navigationEntry.responseStart - navigationEntry.requestStart;
  }

  return metrics;
}

/**
 * Report Web Vitals
 * Send metrics to analytics service
 */
export function reportWebVitals(
  metric: {
    name: string;
    value: number;
    id: string;
    delta: number;
    rating: string;
  }
): void {
  // Send to analytics
  console.log('[Web Vitals]', metric);

  // Example: Send to analytics service
  // if (navigator.sendBeacon) {
  //   navigator.sendBeacon('/api/analytics', JSON.stringify(metric));
  // }
}

/**
 * Usage examples:
 *
 * // Debounce search input
 * const handleSearch = debounce((query) => {
 *   console.log('Searching:', query);
 * }, 300);
 *
 * // Throttle resize handler
 * window.addEventListener('resize', throttle(() => {
 *   console.log('Window resized');
 * }, 500));
 *
 * // Memoize expensive calculation
 * const expensiveCalc = memoize((a, b) => {
 *   return a + b;
 * });
 *
 * // Measure function performance
 * const optimizedFunc = measurePerformance(myFunction, 'myFunction');
 */

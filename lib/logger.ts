/* eslint-disable no-console */

export const logger = {
  info: (...args: unknown[]) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log(...args);
    }
  },

  warn: (...args: unknown[]) => {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(...args);
    }
  },

  error: (...args: unknown[]) => {
    if (process.env.NODE_ENV !== 'production') {
      console.error(...args);
    }
  },
};

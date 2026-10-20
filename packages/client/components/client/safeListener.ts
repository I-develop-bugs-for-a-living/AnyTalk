/**
 * Wrap an event listener so an error in it is caught. The library emits
 * events inside the batch that updates unread state, so a throwing listener
 * would abort that update.
 * @param name Name for the log
 * @param listener Listener to wrap
 * @returns Listener that never throws
 */
export function neverThrows<A extends unknown[]>(
  name: string,
  listener: (...args: A) => void,
): (...args: A) => void {
  return (...args) => {
    try {
      listener(...args);
    } catch (error) {
      console.error(`[${name}] listener failed`, error);
    }
  };
}

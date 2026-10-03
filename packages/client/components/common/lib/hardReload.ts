/**
 * Reload the page with fresh files from the server, like Ctrl+F5: stops
 * the service worker, deletes its caches (the app's code, fonts and
 * language) and refreshes the browser's copy of the page.
 *
 * Login, settings and everything else kept on the device stay, they live
 * in other storage. A lost push subscription is restored on the next start
 * (see NotificationsController).
 *
 * @returns false when offline, nothing is cleared then
 */
export async function hardReload() {
  // without a connection the cleared page couldn't load again
  if (!navigator.onLine) return false;

  // each step is best effort, the reload happens regardless

  try {
    const registrations =
      (await navigator.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(registrations.map((r) => r.unregister()));
  } catch (err) {
    console.error("[reload] could not stop the service worker", err);
  }

  try {
    if ("caches" in window) {
      for (const key of await caches.keys()) await caches.delete(key);
    }
  } catch (err) {
    console.error("[reload] could not clear caches", err);
  }

  try {
    // replace the browser's cached copy of the page itself
    await fetch(location.href, { cache: "reload", credentials: "same-origin" });
  } catch (err) {
    console.error("[reload] could not refresh the page", err);
  }

  location.reload();
  return true;
}

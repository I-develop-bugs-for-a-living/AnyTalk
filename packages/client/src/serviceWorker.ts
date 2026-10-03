/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";

declare let self: ServiceWorkerGlobalScope;

interface ChannelPartial {
  channel_type: string;
  name?: string;
}

interface StoatPushNotification {
  title?: string;
  author?: string;
  body: string;
  icon?: string;
  channel?: ChannelPartial;
  url?: string;
}

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (typeof event.notification.data === "string") {
    event.waitUntil(self.clients.openWindow(event.notification.data));
  }
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  const payload = event.data.text();

  const notification: StoatPushNotification = JSON.parse(payload);

  if (!notification.title) {
    if (notification.channel) {
      if (notification.channel.channel_type === "DirectMessage") {
        notification.title = notification.author || "AnyTalk";
      } else {
        notification.title = `${notification.author} in ${notification.channel.name}`;
      }
    } else {
      notification.title = "AnyTalk";
    }
  }

  notification.url ||= self.registration.scope;

  event.waitUntil(
    self.registration.showNotification(notification.title || "AnyTalk", {
      icon: notification.icon,
      body: notification.body,
      data: notification.url,
    }),
  );
});

cleanupOutdatedCaches();

// Generate list using mise scripts:locale
// prettier-ignore
const locale_keys = ["af","am","ar-dz","ar-iq","ar-kw","ar-ly","ar-ma","ar-sa","ar-tn","ar","az","be","bg","bi","bm","bn-bd","bn","bo","br","bs","ca","cs","cv","cy","da","de-at","de-ch","de","dv","el","en-au","en-ca","en-gb","en-ie","en-il","en-in","en-nz","en-sg","en-tt","en","eo","es-do","es-mx","es-pr","es-us","es","et","eu","fa","fi","fo","fr-ca","fr-ch","fr","fy","ga","gd","gl","gom-latn","gu","he","hi","hr","ht","hu","hy-am","id","is","it-ch","it","ja","jv","ka","kk","km","kn","ko","ku","ky","lb","lo","lt","lv","me","mi","mk","ml","mn","mr","ms-my","ms","mt","my","nb","ne","nl-be","nl","nn","oc-lnc","pa-in","pl","pt-br","pt","rn","ro","ru","rw","sd","se","si","sk","sl","sq","sr-cyrl","sr","ss","sv-fi","sv","sw","ta","te","tet","tg","th","tk","tl-ph","tlh","tr","tzl","tzm-latn","tzm","ug-cn","uk","ur","uz-latn","uz","vi","x-pseudo","yo","zh-cn","zh-hk","zh-tw","zh"];

/** Hashed chunk name, e.g. "de" for "de-AbC12_-x.js" */
function chunkName(fileName: string) {
  const match = fileName.match(/^(.+)-[A-Za-z0-9_-]{8}\.js$/);
  return match?.[1];
}

/**
 * Which kind of language file a URL is, if any: lingui translations or a
 * dayjs date and time locale. They're left out of the precache because
 * everyone only needs one of each.
 */
function languageFile(fileName: string): "translation" | "time" | undefined {
  const name = chunkName(fileName);
  if (name === "messages") return "translation";
  if (name && locale_keys.includes(name)) return "time";
}

const LANGUAGE_CACHE = "anytalk-language";

/**
 * Serve language files from the cache, keeping only the newest file of each
 * kind: the language in use (switching language reloads the page)
 */
async function cachedLanguageFile(
  request: Request,
  kind: "translation" | "time",
) {
  const cache = await caches.open(LANGUAGE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    for (const key of await cache.keys()) {
      const fileName = new URL(key.url).pathname.split("/").pop() ?? "";
      if (languageFile(fileName) === kind) await cache.delete(key);
    }
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const kind = languageFile(url.pathname.split("/").pop() ?? "");
  if (kind) event.respondWith(cachedLanguageFile(event.request, kind));
});

precacheAndRoute(
  self.__WB_MANIFEST.filter((entry) => {
    try {
      const url = typeof entry === "string" ? entry : entry.url;
      if (url.includes("-legacy")) return false;

      const fn = url.split("/").pop();
      if (fn) {
        if (fn.endsWith("css") && !isNaN(parseInt(fn.substring(0, 3)))) {
          return false;
        }

        // Don't cache index.html under any circumstances
        if (fn.endsWith(".html")) {
          return false;
        }

        // Language files are cached once used, see cachedLanguageFile
        if (languageFile(fn)) {
          return false;
        }
      }

      return true;
    } catch {
      return false;
    }
  }),
);

/**
 * Constructor of livekit-client's E2EE worker. Vite bundles the worker as its
 * own file and only loads it when it is instantiated, so the main bundle does
 * not grow and nothing is fetched outside of calls. Kept in its own module so
 * everything else in `e2ee/` stays free of Vite-only imports (and testable).
 */
export { default as E2eeWorker } from "livekit-client/e2ee-worker?worker";

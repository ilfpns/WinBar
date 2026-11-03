/**
 * Firebase, loaded on demand. The web config comes from `.env.local` at build time (VITE_FIREBASE_*); without it
 * the app stays fully local, exactly as before. These values identify the project — they are not secrets:
 * access is enforced by the Firestore security rules (firestore.rules).
 */
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
};

/** Sign-in and cloud sync: invited Google accounts only (off: the app runs local-only with no gate). */
const SIGN_IN_ENABLED = true;

export const cloudConfigured = SIGN_IN_ENABLED && Boolean(config.apiKey && config.projectId && config.authDomain);

export type Fb = Awaited<ReturnType<typeof loadFirebase>>;

let loading: ReturnType<typeof load> | null = null;
/** Loaded once; a failed load (offline, a part of the build gone after a deploy) may be tried again. */
export const loadFirebase = () => (loading ??= load().catch((e: unknown) => {
  loading = null;
  throw e;
}));

async function load() {
  const [{ initializeApp, getApps }, authMod, fs] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore')]);
  const app = getApps()[0] ?? initializeApp(config as Record<string, string>);
  const auth = authMod.getAuth(app);
  // Firestore keeps its own offline copy and queues writes made offline. A field left undefined is dropped
  // instead of refusing the whole write. A browser that can't keep the copy (storage blocked, a private window)
  // still syncs, from memory.
  let db: ReturnType<typeof fs.initializeFirestore>;
  try {
    db = fs.initializeFirestore(app, {
      ignoreUndefinedProperties: true,
      localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
    });
  } catch {
    try {
      db = fs.initializeFirestore(app, { ignoreUndefinedProperties: true, localCache: fs.memoryLocalCache() });
    } catch {
      // already set up (a load tried again): the one there is
      db = fs.getFirestore(app);
    }
  }
  return { app, auth, authMod, db, fs };
}

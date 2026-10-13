import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { AppError } from './errors';

export function firebaseProjectId() {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  if (!projectId) throw new AppError('Firebase project configuration is missing.', 503);
  return projectId;
}

function app() {
  const existing = getApps().find((app) => app.name === 'tsogo-dashboard');
  if (existing) return existing;
  const emulator = process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (emulator) {
    for (const host of [process.env.FIRESTORE_EMULATOR_HOST, process.env.FIREBASE_AUTH_EMULATOR_HOST]) {
      if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) {
        throw new Error('Firebase emulators must use a loopback address.');
      }
    }
    if (!firebaseProjectId().startsWith('demo-')) throw new Error('Emulators require an isolated demo- project.');
  }
  return initializeApp({ projectId: firebaseProjectId(), ...(emulator ? {} : { credential: applicationDefault() }) }, 'tsogo-dashboard');
}

export const firebaseAuth = () => getAuth(app());
export const firestore = () => getFirestore(app(), process.env.FIRESTORE_DATABASE_ID || '(default)');

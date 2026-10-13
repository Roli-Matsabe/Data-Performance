import { firebaseProjectId } from '@/lib/firebase-admin';
import { errorResponse, AppError } from '@/lib/errors';

export async function GET() {
  try {
    const projectId = firebaseProjectId();
    const emulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    const apiKey = process.env.FIREBASE_WEB_API_KEY;
    if (!apiKey && !emulator) throw new AppError('Firebase sign-in has not been configured yet.', 503);
    return Response.json({
      apiKey: apiKey || 'demo-key', projectId,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
      ...(emulator && projectId.startsWith('demo-') ? { emulatorUrl: `http://${emulator}` } : {}),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}

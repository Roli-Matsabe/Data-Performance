import { createHash } from 'node:crypto';
import type { DocumentReference, DocumentSnapshot, Transaction } from 'firebase-admin/firestore';
import { firestore } from './firebase-admin';
import { AppError } from './errors';
import { baseline, has, kinds, mergeImport, normalize, type PropertyReport } from './reporting';

export type Connection = {
  owner: string; client_id: string; client_secret: string; refresh_token: string | null;
  config: string | null; connected_at: string | null; last_sync: string | null;
  last_error: string | null; revision: number;
};

const CHUNK_BYTES = 400_000;
const MAX_REPORT_BYTES = 4_000_000;
const ownerRef = (owner: string) => {
  if (!owner || owner.length > 128) throw new AppError('Invalid account.', 401);
  return firestore().collection('dashboardUsers').doc(Buffer.from(owner).toString('base64url'));
};
const connectionRef = (owner: string) => ownerRef(owner).collection('private').doc('googleConnection');
const oauthRef = (owner: string) => ownerRef(owner).collection('private').doc('googleOAuth');
const lockRef = (owner: string) => ownerRef(owner).collection('private').doc('googleSync');
function reportRef(owner: string, kind: 'reports' | 'googleReports', propertyId: string, month: string) {
  if (!/^[a-z0-9-]+$/.test(propertyId) || !/^20\d\d-(0[1-9]|1[0-2])$/.test(month)) throw new AppError('Invalid report.');
  return ownerRef(owner).collection(kind).doc(`${propertyId}_${month}`);
}

async function readPayload(transaction: Transaction, snapshot: DocumentSnapshot): Promise<PropertyReport | undefined> {
  if (!snapshot.exists) return undefined;
  const data = snapshot.data()!;
  if (!Number.isInteger(data.parts) || data.parts < 1 || data.parts > MAX_REPORT_BYTES / CHUNK_BYTES) throw new Error('Invalid report metadata.');
  const refs = Array.from({ length: data.parts }, (_, i) => snapshot.ref.collection('chunks').doc(String(i)));
  const chunks = await transaction.getAll(...refs);
  if (chunks.some((chunk) => !chunk.exists)) throw new Error('Incomplete saved report.');
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.data()!.bytes)));
  if (createHash('sha256').update(bytes).digest('hex') !== data.sha256) throw new Error('Saved report checksum mismatch.');
  return normalize(JSON.parse(bytes.toString('utf8')));
}

function writePayload(transaction: Transaction, ref: DocumentReference, report: PropertyReport, oldParts: number, fields: Record<string, unknown> = {}) {
  const bytes = Buffer.from(JSON.stringify(report));
  if (bytes.length > MAX_REPORT_BYTES) throw new AppError('The combined report is too large. Split it by property.');
  const parts = Math.ceil(bytes.length / CHUNK_BYTES);
  for (let i = 0; i < parts; i++) transaction.set(ref.collection('chunks').doc(String(i)), { bytes: bytes.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES) });
  for (let i = parts; i < oldParts; i++) transaction.delete(ref.collection('chunks').doc(String(i)));
  transaction.set(ref, {
    propertyId: report.propertyId, month: report.month, revision: report.revision,
    parts, sha256: createHash('sha256').update(bytes).digest('hex'), updatedAt: new Date().toISOString(), ...fields,
  });
}

export async function listReports(owner: string, kind: 'reports' | 'googleReports' = 'reports', configKey?: string) {
  const collection = ownerRef(owner).collection(kind);
  const snapshots = await (configKey ? collection.where('configKey', '==', configKey) : collection).get();
  const reports = await Promise.all(snapshots.docs.map((snapshot) => firestore().runTransaction(async (transaction) => {
    const current = await transaction.get(snapshot.ref);
    if (configKey && current.data()?.configKey !== configKey) return undefined;
    return readPayload(transaction, current);
  })));
  return reports.filter((report): report is PropertyReport => !!report).sort((a, b) => b.month.localeCompare(a.month));
}

export async function saveImport(owner: string, incoming: PropertyReport, expectedRevision: number, replace: boolean) {
  const ref = reportRef(owner, 'reports', incoming.propertyId, incoming.month);
  return firestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const existing = await readPayload(transaction, snapshot) || (incoming.propertyId === 'emerald' ? baseline.find((report) => report.month === incoming.month) : undefined);
    const revision = snapshot.data()?.revision || 0;
    if (revision !== expectedRevision) throw new AppError('This report changed since you opened it. Refresh saved reports before importing.', 409);
    if (!replace && kinds.some((kind) => has(incoming, kind) && has(existing, kind))) throw new AppError('Confirm replacement of the selected report types.', 409);
    let result: PropertyReport;
    try { result = mergeImport(existing, incoming); }
    catch (error) { throw new AppError(error instanceof Error ? error.message : 'Inconsistent exports.'); }
    result.revision = revision + 1;
    writePayload(transaction, ref, result, snapshot.data()?.parts || 0);
    return result;
  });
}

export async function getConnection(owner: string): Promise<Connection | null> {
  const snapshot = await connectionRef(owner).get();
  return snapshot.exists ? snapshot.data() as Connection : null;
}

export async function saveCredentials(owner: string, clientId: string, clientSecret: string) {
  const ref = connectionRef(owner);
  await firestore().runTransaction(async (transaction) => {
    const previous = await transaction.get(ref);
    transaction.set(ref, {
      owner, client_id: clientId, client_secret: clientSecret,
      refresh_token: null, config: null, connected_at: null, last_sync: null, last_error: null,
      revision: (previous.data()?.revision || 0) + 1,
    } satisfies Connection);
    transaction.delete(oauthRef(owner));
  });
}

export async function updateConnection(owner: string, patch: Partial<Omit<Connection, 'owner' | 'revision'>>, expectedRevision?: number, requireRefresh = false, bumpRevision = true) {
  const ref = connectionRef(owner);
  return firestore().runTransaction(async (transaction) => {
    const current = await transaction.get(ref);
    const data = current.data() as Connection | undefined;
    if (!data || (expectedRevision !== undefined && data.revision !== expectedRevision) || (requireRefresh && !data.refresh_token)) return false;
    transaction.update(ref, { ...patch, revision: data.revision + (bumpRevision ? 1 : 0) });
    return true;
  });
}

export async function disconnect(owner: string, expectedRevision: number) {
  return firestore().runTransaction(async (transaction) => {
    const ref = connectionRef(owner), current = await transaction.get(ref);
    if (current.data()?.revision !== expectedRevision) return false;
    transaction.update(ref, { refresh_token: null, connected_at: null, last_error: null, revision: expectedRevision + 1 });
    transaction.delete(oauthRef(owner));
    return true;
  });
}

export async function saveOAuthState(owner: string, hash: string, verifier: string, revision: number) {
  return firestore().runTransaction(async (transaction) => {
    const current = await transaction.get(connectionRef(owner));
    if (current.data()?.revision !== revision) throw new AppError('Connection setup changed. Please retry.', 409);
    transaction.set(oauthRef(owner), { hash, verifier, expires: Date.now() + 600_000 });
  });
}

export async function consumeOAuthState(owner: string, hash: string): Promise<{ verifier: string } | null> {
  const ref = oauthRef(owner);
  return firestore().runTransaction(async (transaction) => {
    const current = await transaction.get(ref), data = current.data();
    if (!data || data.hash !== hash || data.expires <= Date.now()) return null;
    transaction.delete(ref);
    return { verifier: data.verifier as string };
  });
}

export async function claimSync(owner: string, token: string) {
  const ref = lockRef(owner);
  return firestore().runTransaction(async (transaction) => {
    const current = await transaction.get(ref);
    if ((current.data()?.expires || 0) > Date.now()) return false;
    transaction.set(ref, { token, expires: Date.now() + 600_000 });
    return true;
  });
}

export async function releaseSync(owner: string, token: string) {
  const ref = lockRef(owner);
  await firestore().runTransaction(async (transaction) => {
    const current = await transaction.get(ref);
    if (current.data()?.token === token) transaction.delete(ref);
  });
}

export async function saveGoogleReport(owner: string, report: PropertyReport, configKey: string, revision: number, token: string) {
  const ref = reportRef(owner, 'googleReports', report.propertyId, report.month);
  return firestore().runTransaction(async (transaction) => {
    const [connection, lock, previous] = await transaction.getAll(connectionRef(owner), lockRef(owner), ref);
    if (!connection.data()?.refresh_token || connection.data()?.revision !== revision || lock.data()?.token !== token || lock.data()?.expires <= Date.now()) return false;
    const now = new Date().toISOString();
    writePayload(transaction, ref, report, previous.data()?.parts || 0, { configKey, syncedAt: now });
    transaction.update(connectionRef(owner), { last_sync: now, last_error: null });
    return true;
  });
}

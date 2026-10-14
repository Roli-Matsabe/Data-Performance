import type { Owner } from './auth';
import { AppError } from './errors';
import { baseline, has, kinds, mergeImport, normalize, type PropertyReport } from './reporting';

export type Connection = {
  owner: string; client_id: string; client_secret: string; refresh_token: string | null;
  config: string | null; connected_at: string | null; last_sync: string | null;
  last_error: string | null; revision: number;
};

async function operation<T>(owner: Owner, action: string, payload: Record<string, unknown> = {}): Promise<T> {
  // Supabase validates the user's JWT. SQL derives ownership from auth.uid(),
  // checks the database allowlist, and commits each operation atomically.
  const { data, error } = await owner.db.rpc('dashboard_operation', { action, payload });
  if (error) {
    if (error.code === 'PT409') throw new AppError('This report or connection changed. Refresh and retry.', 409);
    if (error.code === '42501' || error.code === 'PT403') throw new AppError('This account has not been approved for the dashboard.', 403);
    if (error.code === 'PT400' || error.code === '23514') throw new AppError('The report or connection settings are invalid.');
    throw new AppError('Dashboard storage is unavailable. Check the Supabase database setup and retry.', 503);
  }
  return data as T;
}

function reportIdentity(propertyId: string, month: string) {
  if (!/^[a-z0-9-]+$/.test(propertyId) || !/^20\d\d-(0[1-9]|1[0-2])$/.test(month)) throw new AppError('Invalid report.');
  return { propertyId, month };
}

function checkSize(report: PropertyReport) {
  // Reserve space for PostgreSQL JSONB's text representation and separators.
  if (Buffer.byteLength(JSON.stringify(report)) > 3_500_000) throw new AppError('The combined report is too large. Split it by property.');
}

export async function listReports(owner: Owner, kind: 'reports' | 'googleReports' = 'reports', configKey?: string) {
  const reports = await operation<PropertyReport[]>(owner, 'list_reports', { kind, configKey });
  return reports.map(normalize).sort((a, b) => b.month.localeCompare(a.month));
}

export async function saveImport(owner: Owner, incoming: PropertyReport, expectedRevision: number, replace: boolean) {
  const identity = reportIdentity(incoming.propertyId, incoming.month);
  const saved = await operation<PropertyReport | null>(owner, 'get_report', { ...identity, kind: 'reports' });
  const revision = saved?.revision || 0;
  if (revision !== expectedRevision) throw new AppError('This report changed since you opened it. Refresh saved reports before importing.', 409);
  const existing = saved ? normalize(saved) : (incoming.propertyId === 'emerald' ? baseline.find((report) => report.month === incoming.month) : undefined);
  if (!replace && kinds.some((kind) => has(incoming, kind) && has(existing, kind))) throw new AppError('Confirm replacement of the selected report types.', 409);
  let result: PropertyReport;
  try { result = mergeImport(existing, incoming); }
  catch (error) { throw new AppError(error instanceof Error ? error.message : 'Inconsistent exports.'); }
  result.revision = revision + 1;
  checkSize(result);
  // The SQL revision precondition prevents another writer winning between read and write.
  return normalize(await operation<PropertyReport>(owner, 'save_import', { ...identity, expectedRevision, report: result }));
}

export const getConnection = (owner: Owner) => operation<Connection | null>(owner, 'get_connection');
export const saveCredentials = (owner: Owner, clientId: string, clientSecret: string) => operation<void>(owner, 'save_credentials', { clientId, clientSecret });
export const updateConnection = (owner: Owner, patch: Partial<Omit<Connection, 'owner' | 'revision'>>, expectedRevision?: number, requireRefresh = false, bumpRevision = true) =>
  operation<boolean>(owner, 'update_connection', { patch, expectedRevision, requireRefresh, bumpRevision });
export const disconnect = (owner: Owner, expectedRevision: number) => operation<boolean>(owner, 'disconnect', { expectedRevision });
export const saveOAuthState = (owner: Owner, hash: string, verifier: string, revision: number) => operation<void>(owner, 'save_oauth', { hash, verifier, revision });
export const consumeOAuthState = (owner: Owner, hash: string) => operation<{ verifier: string } | null>(owner, 'consume_oauth', { hash });
export const claimSync = (owner: Owner, token: string) => operation<boolean>(owner, 'claim_sync', { token });
export const releaseSync = (owner: Owner, token: string) => operation<void>(owner, 'release_sync', { token });

export async function saveGoogleReport(owner: Owner, report: PropertyReport, configKey: string, revision: number, token: string) {
  const identity = reportIdentity(report.propertyId, report.month);
  checkSize(report);
  return operation<boolean>(owner, 'save_google_report', { ...identity, report, configKey, revision, token });
}

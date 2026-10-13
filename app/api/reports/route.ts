import { requireOwner } from '@/lib/auth';
import { AppError, errorResponse } from '@/lib/errors';
import { listReports, saveImport } from '@/lib/report-store';
import { parseImport } from '@/lib/reporting';

export async function GET(request: Request) {
  try {
    const owner = await requireOwner(request);
    return Response.json({ reports: await listReports(owner) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const owner = await requireOwner(request, true);
    const text = await request.text();
    if (Buffer.byteLength(text) > 2_000_000) throw new AppError('Keep each import below 1.9 MB.', 413);
    let body;
    try { body = JSON.parse(text); } catch { throw new AppError('Invalid import.'); }
    if (!body || !Array.isArray(body.files) || body.files.some((file: { name?: unknown; text?: unknown } | null) => !file || typeof file.name !== 'string' || typeof file.text !== 'string')) throw new AppError('Select CSV files.');
    if (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 0) throw new AppError('Invalid report revision.');
    let incoming;
    try { incoming = parseImport(body.propertyId, body.month, body.files, body.scopeConfirmed === true, body.searchConfirmed === true); }
    catch (error) { throw new AppError(error instanceof Error ? error.message : 'Invalid data.'); }
    return Response.json({ report: await saveImport(owner, incoming, body.expectedRevision, body.replace === true) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}

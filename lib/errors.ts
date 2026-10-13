export class AppError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function errorResponse(error: unknown) {
  return Response.json(
    { error: error instanceof AppError ? error.message : 'The service is temporarily unavailable. Please retry.' },
    { status: error instanceof AppError ? error.status : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}

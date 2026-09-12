// Request body validation using zod schemas, plus a shared async handler wrapper.

export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    req.valid = result.data;
    next();
  };
}

// Wrap async route handlers so thrown errors reach the error middleware.
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// Central error handler (registered last).
export function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const requestId = req.headers['x-request-id'] || req.id || '-';

  // Structured error log with request context
  const logEntry = {
    level: 'error',
    status,
    message: err.message,
    path: req.originalUrl || req.url,
    method: req.method,
    ip: req.ip || req.connection?.remoteAddress,
    requestId,
    timestamp: new Date().toISOString(),
  };
  // Include stack in dev, omit in prod
  if (process.env.NODE_ENV !== 'production') {
    logEntry.stack = err.stack;
  }
  console.error('[error]', JSON.stringify(logEntry));

  // Never leak stack traces or internals to clients in production.
  const response = { error: status === 500 ? 'Internal server error' : err.message };
  if (requestId !== '-') response.requestId = requestId;
  if (process.env.NODE_ENV !== 'production' && err.stack) {
    response.stack = err.stack.split('\n').slice(0, 5).join('\n'); // first 5 lines
  }
  res.status(status).json(response);
}

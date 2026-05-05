export function isMissingPostgresConnectionString(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const maybe = err as { code?: unknown; message?: unknown };
  const code = typeof maybe.code === "string" ? maybe.code : "";
  const message = typeof maybe.message === "string" ? maybe.message : "";
  return (
    code === "missing_connection_string" ||
    /missing_connection_string|POSTGRES_URL|connectionString/i.test(message)
  );
}

export function canUseNoDatabaseBookingJobsFallback(
  err: unknown,
  nodeEnv = process.env.NODE_ENV,
): boolean {
  return nodeEnv !== "production" && isMissingPostgresConnectionString(err);
}

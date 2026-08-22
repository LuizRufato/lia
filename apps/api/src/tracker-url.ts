export function getTrackerUrl(
  environment: Record<string, string | undefined> = process.env,
): string {
  return (
    environment.TRACKER_URL?.trim() ||
    (environment.NODE_ENV === 'production'
      ? 'http://tracker:3002'
      : 'http://127.0.0.1:3002')
  );
}

const DEFAULT_DASHBOARD_PORT = 3000;

export function resolveDashboardPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PROMPT_REFINER_DASHBOARD_PORT || env.PORT;
  if (!raw) return DEFAULT_DASHBOARD_PORT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`Invalid dashboard port: ${raw}`);
  }
  return parsed;
}

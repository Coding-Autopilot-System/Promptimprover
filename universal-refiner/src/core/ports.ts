export const OPERATOR_DASHBOARD_PORT = 3000;

export function resolveDashboardPort(
  preferred = process.env.PROMPT_REFINER_DASHBOARD_PORT,
  legacy = process.env.PORT,
): number {
  const configured = preferred || legacy;
  if (!configured) {
    return OPERATOR_DASHBOARD_PORT;
  }

  const port = Number.parseInt(configured, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return OPERATOR_DASHBOARD_PORT;
  }
  return port;
}

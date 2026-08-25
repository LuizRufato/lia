export function buildAdminAlertJobId(
  alertId: string,
  deliveryId?: string,
): string {
  return deliveryId
    ? `admin-alert-${alertId}-delivery-${deliveryId}`
    : `admin-alert-${alertId}`;
}

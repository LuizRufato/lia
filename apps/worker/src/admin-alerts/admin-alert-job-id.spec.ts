import { buildAdminAlertJobId } from './admin-alert-job-id';

describe('buildAdminAlertJobId', () => {
  it('creates deterministic ids without BullMQ-prohibited colons', () => {
    const first = buildAdminAlertJobId('alert-1', 'delivery-1');
    const second = buildAdminAlertJobId('alert-1', 'delivery-1');

    expect(first).toBe('admin-alert-alert-1-delivery-delivery-1');
    expect(first).toBe(second);
    expect(first).not.toContain(':');
  });

  it('creates a deterministic legacy alert id without a delivery suffix', () => {
    expect(buildAdminAlertJobId('alert-1')).toBe('admin-alert-alert-1');
  });
});

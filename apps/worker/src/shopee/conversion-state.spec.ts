import {
  conversionPageJobId,
  deriveCommissionStatus,
  normalizeOrderStatus,
} from './conversion-state';

describe('Shopee conversion state', () => {
  it('normalizes the supported Shopee order statuses', () => {
    expect(normalizeOrderStatus('PAID')).toBe('COMPLETED');
    expect(normalizeOrderStatus('CANCELED')).toBe('CANCELLED');
    expect(normalizeOrderStatus('processing')).toBe('PENDING');
    expect(normalizeOrderStatus('unknown-value')).toBe('PENDING');
  });

  it('does not count unpaid or cancelled orders as confirmed commission', () => {
    expect(deriveCommissionStatus(['UNPAID'])).toBe('ESTIMATED');
    expect(deriveCommissionStatus(['PENDING'])).toBe('PENDING');
    expect(deriveCommissionStatus(['COMPLETED'])).toBe('CONFIRMED');
    expect(deriveCommissionStatus(['CANCELLED'])).toBe('CANCELLED');
  });

  it('generates a stable id for the same conversion page', () => {
    expect(conversionPageJobId('tenant', 1, 2, 'cursor')).toBe(
      conversionPageJobId('tenant', 1, 2, 'cursor'),
    );
    expect(conversionPageJobId('tenant', 1, 2, 'cursor')).not.toBe(
      conversionPageJobId('tenant', 1, 2, 'other-cursor'),
    );
  });
});

import {
  getMinutesSinceMidnight,
  nextLocalDay,
  nextScheduleStart,
  startOfLocalDay,
} from './timezone';

describe('Autopilot timezone helpers', () => {
  const zone = 'America/Campo_Grande';

  it('uses tenant local time around UTC midnight', () => {
    const instant = new Date('2026-08-22T04:30:00.000Z');
    expect(getMinutesSinceMidnight(instant, zone)).toBe(30);
    expect(startOfLocalDay(instant, zone).toISOString()).toBe(
      '2026-08-22T04:00:00.000Z',
    );
  });

  it('computes the next local day without using the worker host timezone', () => {
    const instant = new Date('2026-08-22T23:00:00.000Z');
    expect(nextLocalDay(instant, zone).toISOString()).toBe(
      '2026-08-23T04:00:00.000Z',
    );
  });

  it('returns the next allowed wall-clock window', () => {
    const instant = new Date('2026-08-22T13:00:00.000Z'); // 09:00 local
    expect(nextScheduleStart(instant, zone, 10 * 60, 20 * 60).toISOString()).toBe(
      '2026-08-22T14:00:00.000Z',
    );
  });
});

import { buildEmptyActivity, formatDate } from './Analytics';

const originalTimezone = process.env.TZ;
const dateFormatOptions: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
};

function setTimezone(timezone: string | undefined) {
  if (timezone) {
    process.env.TZ = timezone;
    return;
  }
  delete process.env.TZ;
}

describe('Analytics date formatting', () => {
  afterEach(() => {
    setTimezone(originalTimezone);
  });

  it.each(['Pacific/Honolulu', 'America/Los_Angeles', 'America/New_York', 'UTC'])(
    'displays date-only analytics buckets as calendar dates in %s',
    (timezone) => {
      setTimezone(timezone);

      expect(formatDate('2026-07-08')).toBe(
        new Date(2026, 6, 8).toLocaleDateString(undefined, dateFormatOptions),
      );
    },
  );

  it('returns Never for empty dates', () => {
    expect(formatDate('')).toBe('Never');
  });

  it.each(['not-a-date', '2026-02-30', '2026-13-08'])(
    'returns invalid dates as-is: %s',
    (value) => {
      expect(formatDate(value)).toBe(value);
    },
  );

  it('builds empty activity with local calendar date keys', () => {
    setTimezone('Asia/Tokyo');
    const today = new Date();
    const expectedToday = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0'),
    ].join('-');

    const activity = buildEmptyActivity();

    expect(activity).toHaveLength(365);
    expect(activity[activity.length - 1].date).toBe(expectedToday);
  });
});

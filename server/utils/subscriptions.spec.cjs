// describe/it/expect come from vitest's globals (see vitest.config.ts) --
// this file can't `require('vitest')` directly from CommonJS.
const {
  addDays,
  nextBakeDateAfter,
  rollForward,
  formatBakeDate,
  weekdayOf,
  parseSkipped
} = require('./subscriptions.cjs');

describe('addDays', () => {
  it('adds days across a month boundary in UTC', () => {
    expect(addDays('2026-09-28', 7)).toBe('2026-10-05');
  });

  it('handles negative offsets', () => {
    expect(addDays('2026-10-05', -7)).toBe('2026-09-28');
  });
});

describe('nextBakeDateAfter', () => {
  it('is one week later when nothing is skipped', () => {
    expect(nextBakeDateAfter('2026-09-28')).toBe('2026-10-05');
  });

  it('jumps over a skipped week', () => {
    expect(nextBakeDateAfter('2026-09-28', ['2026-10-05'])).toBe('2026-10-12');
  });

  it('jumps over consecutive skipped weeks', () => {
    expect(nextBakeDateAfter('2026-09-28', ['2026-10-05', '2026-10-12'])).toBe('2026-10-19');
  });

  it('ignores skipped dates that are not on the path', () => {
    expect(nextBakeDateAfter('2026-09-28', ['2026-10-06'])).toBe('2026-10-05');
  });
});

describe('rollForward', () => {
  it('leaves a future date alone', () => {
    expect(rollForward('2026-10-05', '2026-09-30')).toBe('2026-10-05');
  });

  it('keeps today', () => {
    expect(rollForward('2026-10-05', '2026-10-05')).toBe('2026-10-05');
  });

  it('advances several weeks at once', () => {
    expect(rollForward('2026-09-07', '2026-09-30')).toBe('2026-10-05');
  });

  it('advances past skipped weeks while rolling', () => {
    expect(rollForward('2026-09-28', '2026-10-06', ['2026-10-12'])).toBe('2026-10-19');
  });
});

describe('formatBakeDate / weekdayOf', () => {
  it('formats as a long weekday and month', () => {
    expect(formatBakeDate('2026-10-05')).toBe('Monday, October 5');
  });

  it('reports Monday and Tuesday as 1 and 2', () => {
    expect(weekdayOf('2026-10-05')).toBe(1);
    expect(weekdayOf('2026-10-06')).toBe(2);
  });

  it('does not blow up on garbage', () => {
    expect(formatBakeDate(null)).toBe('');
    expect(weekdayOf('nope')).toBeNull();
  });
});

describe('parseSkipped', () => {
  it('accepts arrays, JSON strings, and junk', () => {
    expect(parseSkipped(['2026-10-05', 'x'])).toEqual(['2026-10-05']);
    expect(parseSkipped('["2026-10-05"]')).toEqual(['2026-10-05']);
    expect(parseSkipped('not json')).toEqual([]);
    expect(parseSkipped(null)).toEqual([]);
  });
});

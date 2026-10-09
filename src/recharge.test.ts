import { describe, expect, it } from 'vitest';
import { rechargeAvailable, rechargeCampus } from './recharge';

describe('official recharge link campus gating', () => {
  it('uses the signed-in campus over a stale login selector', () => {
    expect(rechargeCampus('GZIC', 'DXC')).toBe('GZIC');
    expect(rechargeAvailable('GZIC', 'DXC')).toBe(false);
  });
  it('allows the verified DXC entry with or without a session', () => {
    expect(rechargeAvailable('DXC', 'GZIC')).toBe(true);
    expect(rechargeAvailable(null, 'DXC')).toBe(true);
  });
  it('never reuses DXC link for selected GZIC on the logged-out page', () => {
    expect(rechargeAvailable(null, 'GZIC')).toBe(false);
  });
});

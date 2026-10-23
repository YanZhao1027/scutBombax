import { describe, expect, it } from 'vitest';
import { ACTIVITY_PUBLIC, activityDestinationUrl, trustedActivityUrl } from './activity-portal';

describe('independent production activity origin', () => {
  it('launches only the canonical HTTPS public entry, not a staging server', () => {
    expect(ACTIVITY_PUBLIC).toBe('https://activity.10273055.xyz/');
    expect(activityDestinationUrl('activity')).toBe(ACTIVITY_PUBLIC);
    expect(trustedActivityUrl(ACTIVITY_PUBLIC)).toBe(true);
  });
  it.each([
    'http://activity.10273055.xyz/',
    'https://activity-stage.10273055.xyz/',
    'https://activity-demo.10273055.xyz/',
    'https://activity-lan.10273055.xyz:8443/',
    'https://ecardwxnew.scut.edu.cn/',
    'https://activity.10273055.xyz.evil.invalid/',
    'https://activity.10273055.xyz@evil.invalid/',
    'https://evil.invalid@activity.10273055.xyz/',
    'https://activity.10273055.xyz:8443/',
    'https://activity.10273055.xyz/api/login',
    'https://activity.10273055.xyz/?token=secret',
    'https://activity.10273055.xyz/#pass=secret',
    'javascript:alert(1)',
    'not a URL',
  ])('rejects disallowed initial activity destination %s', url => {
    expect(trustedActivityUrl(url)).toBe(false);
  });
  it('rejects any stale destination value from older app code', () => {
    expect(() => activityDestinationUrl('stage' as never)).toThrow();
    expect(() => activityDestinationUrl('showcase' as never)).toThrow();
  });
});

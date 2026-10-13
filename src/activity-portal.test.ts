import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_STAGE, ACTIVITY_SHOWCASE, activityDestinationUrl, trustedActivityUrl
} from './activity-portal';

describe('independent activity module destinations', () => {
  it('only permits the exact independent Cloudflare HTTPS origins', () => {
    expect(trustedActivityUrl(ACTIVITY_STAGE)).toBe(true);
    expect(trustedActivityUrl(ACTIVITY_SHOWCASE)).toBe(true);
    expect(activityDestinationUrl('stage')).toBe(ACTIVITY_STAGE);
    expect(activityDestinationUrl('showcase')).toBe(ACTIVITY_SHOWCASE);
  });

  it.each([
    'http://activity-stage.10273055.xyz/',
    'https://ecardwxnew.scut.edu.cn/',
    'https://activity-stage.10273055.xyz.evil.invalid/',
    'https://activity-stage.10273055.xyz@evil.invalid/',
    'https://evil.invalid@activity-stage.10273055.xyz/',
    'https://activity-stage.10273055.xyz:8443/',
    'https://activity-stage.10273055.xyz/api/login',
    'https://activity-stage.10273055.xyz/?token=secret',
    'javascript:alert(1)',
    'about:blank',
    'not a URL',
  ])('rejects potentially unsafe destination %s', (url) => {
    expect(trustedActivityUrl(url)).toBe(false);
  });
});

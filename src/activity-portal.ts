import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';

/**
 * The activity site is an independent Cloudflare origin with its OWN credentials.
 * The school balance bridge never sees its cookies or QR tokens.
 *
 * Chrome Custom Tabs supplies Android's trusted HTTPS rendering, location and
 * camera prompts. The local Capacitor page must not fetch or iframe activity
 * data: the stage deliberately has a separate-origin session + CSRF policy.
 */
export const ACTIVITY_STAGE = 'https://activity-stage.10273055.xyz/';
export const ACTIVITY_SHOWCASE = 'https://activity-demo.10273055.xyz/';

export type ActivityDestination = 'stage' | 'showcase';

export function trustedActivityUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.port === '' &&
      parsed.pathname === '/' &&
      parsed.search === '' &&
      parsed.hash === '' &&
      ['activity-stage.10273055.xyz', 'activity-demo.10273055.xyz'].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}

export function activityDestinationUrl(which: ActivityDestination): string {
  const url = which === 'stage' ? ACTIVITY_STAGE : ACTIVITY_SHOWCASE;
  if (!trustedActivityUrl(url)) throw new Error('活动服务地址未通过安全检查');
  return url;
}

/** Android: Custom Tabs. Browser preview: a distinct HTTPS tab. */
export async function openActivityPortal(which: ActivityDestination): Promise<void> {
  const url = activityDestinationUrl(which);
  if (Capacitor.isNativePlatform()) {
    await Browser.open({ url, toolbarColor: '#F5F7FF' });
    return;
  }
  const popup = window.open(url, '_blank', 'noopener,noreferrer');
  if (!popup) throw new Error('浏览器阻止了打开新标签页，请允许弹窗后重试');
}

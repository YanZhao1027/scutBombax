import { Capacitor, registerPlugin } from '@capacitor/core';

/** One fixed production destination; the WebView cannot be given an arbitrary URL. */
export const ACTIVITY_PUBLIC = 'https://activity.10273055.xyz/';
export type ActivityDestination = 'activity';

const NativeActivityPortal = registerPlugin<{
  open(options: { destination: ActivityDestination }): Promise<{ opened: boolean }>
}>('BombaxActivityPortal');

/**
 * Initial entry always uses the Cloudflare public hostname. The activity site's
 * credential-free health probe decides whether campus LAN HTTPS is reachable.
 * No school billing cookie, bridge or bearer pass enters the native portal.
 */
export function trustedActivityUrl(url: string): boolean {
  try {
    const p = new URL(url);
    return p.protocol === 'https:' &&
      p.username === '' && p.password === '' &&
      p.hostname === 'activity.10273055.xyz' && p.port === '' &&
      p.pathname === '/' && p.search === '' && p.hash === '';
  } catch { return false; }
}

export function activityDestinationUrl(which: ActivityDestination): string {
  if (which !== 'activity' || !trustedActivityUrl(ACTIVITY_PUBLIC)) {
    throw new Error('活动服务地址未通过安全检查');
  }
  return ACTIVITY_PUBLIC;
}

/** Android: isolated WebView; desktop preview: external no-opener HTTPS tab. */
export async function openActivityPortal(): Promise<void> {
  const url = activityDestinationUrl('activity');
  if (Capacitor.isNativePlatform()) {
    await NativeActivityPortal.open({ destination: 'activity' });
    return;
  }
  const popup = window.open(url, '_blank', 'noopener,noreferrer');
  if (!popup) throw new Error('浏览器阻止了打开新标签页，请允许弹窗后重试');
}

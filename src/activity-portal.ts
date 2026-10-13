import { Capacitor, registerPlugin } from '@capacitor/core';

/** Restricted native destination selection — arbitrary URLs never cross the bridge. */
const NativeActivityPortal=registerPlugin<{open(options:{destination:ActivityDestination}):Promise<{opened:boolean}>}>('BombaxActivityPortal');

/**
 * The activity site is an independent Cloudflare origin with its OWN credentials.
 * The school balance bridge never sees its cookies or QR tokens.
 *
 * Android uses an isolated native WebView Activity with explicit per-site
 * camera/location permission prompts and a document picker. No SCUT Kotlin
 * bridge is registered in that WebView; browser cookies remain host-scoped.
 * The local Capacitor water/electricity page never fetches or iframes activity
 * data: the stage requires separate-origin session + CSRF protection.
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

/** Android: isolated native WebView. Browser preview: a distinct HTTPS tab. */
export async function openActivityPortal(which: ActivityDestination): Promise<void> {
  const url = activityDestinationUrl(which);
  if (Capacitor.isNativePlatform()) {
    await NativeActivityPortal.open({ destination: which });
    return;
  }
  const popup = window.open(url, '_blank', 'noopener,noreferrer');
  if (!popup) throw new Error('浏览器阻止了打开新标签页，请允许弹窗后重试');
}

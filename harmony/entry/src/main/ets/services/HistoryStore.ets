import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import { BalanceReading, HistoryPoint } from '../models/SchoolTypes';
import { Protocol } from './Protocol';

export class HistoryStore {
  private pref: preferences.Preferences | null = null;
  private points: HistoryPoint[] = [];

  async init(context: common.UIAbilityContext): Promise<HistoryPoint[]> {
    this.pref = await preferences.getPreferences(context, 'bombax-harmony-history');
    const text = await this.pref.get('balances', '[]') as string;
    try {
      const parsed: HistoryPoint[] = JSON.parse(text) as HistoryPoint[];
      if (!Array.isArray(parsed)) {
        this.points = [];
      } else {
        this.points = parsed.filter((p: HistoryPoint): boolean =>
          p !== null && (p.campus === 'DXC' || p.campus === 'GZIC') &&
          Number.isFinite(p.at) && Number.isFinite(p.electric) &&
          Number.isFinite(p.water) && p.at > 0 &&
          (p.ac === null || Number.isFinite(p.ac))
        ).slice(-400);
      }
    } catch (_) {
      this.points = [];
    }
    return this.points.slice();
  }

  async append(reading: BalanceReading): Promise<HistoryPoint[]> {
    const point = Protocol.snapshot(reading);
    // One user-triggered query gets one history point. No app/background timer.
    this.points.push(point);
    this.points = this.points.slice(-400);
    await this.save();
    return this.points.slice();
  }

  async clear(): Promise<void> {
    this.points = [];
    await this.save();
  }

  private async save(): Promise<void> {
    if (this.pref === null) {
      return;
    }
    await this.pref.put('balances', JSON.stringify(this.points));
    await this.pref.flush();
  }
}

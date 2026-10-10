import {
  KeyboardData, GzicItem, DxcReply, ProtocolFailure, HistoryPoint, BalanceReading
} from '../models/SchoolTypes';

const DIGITS = '0123456789';
const LOWER = 'qwertyuiopasdfghjklzxcvbnm';
const UPPER = 'QWERTYUIOPASDFGHJKLZXCVBNM';
const SYMBOLS = "*\\-[]{}/!<,>?~&@#.:+|" + String.fromCharCode(96) + "%'$;^\"_";

export class Protocol {
  /** Campus card keyboard: fixed tile layouts; random tokens change per session. */
  static encodeKeyboardPassword(plain: string, keyboard: KeyboardData): string {
    if (!plain || !keyboard.uuid) {
      throw new ProtocolFailure('keyboard', '密码或键盘会话无效');
    }
    if (keyboard.numberKeyboard.length !== DIGITS.length ||
        keyboard.lowerLetterKeyboard.length !== LOWER.length ||
        keyboard.upperLetterKeyboard.length !== UPPER.length ||
        keyboard.symbolKeyboard.length !== SYMBOLS.length) {
      throw new ProtocolFailure('keyboard', '学校安全键盘长度发生变化');
    }
    let coded = '';
    for (let i = 0; i < plain.length; i++) {
      const char = plain.charAt(i);
      let index = DIGITS.indexOf(char);
      if (index >= 0) {
        coded += keyboard.numberKeyboard.charAt(index);
        continue;
      }
      index = LOWER.indexOf(char);
      if (index >= 0) {
        coded += keyboard.lowerLetterKeyboard.charAt(index);
        continue;
      }
      index = UPPER.indexOf(char);
      if (index >= 0) {
        coded += keyboard.upperLetterKeyboard.charAt(index);
        continue;
      }
      index = SYMBOLS.indexOf(char);
      if (index >= 0) {
        coded += keyboard.symbolKeyboard.charAt(index);
        continue;
      }
      throw new ProtocolFailure('keyboard', '查询密码包含校园卡键盘不支持的字符');
    }
    return coded + '$1$' + keyboard.uuid;
  }

  static loginBody(username: string, encoded: string, key: string, code: string, loginType: string): string {
    const parts = [
      'username=' + encodeURIComponent(username.trim()),
      'password=' + encodeURIComponent(encoded),
      'grant_type=password',
      'scope=all',
      'loginFrom=h5',
      'logintype=' + encodeURIComponent(loginType),
      'device_token=h5',
      'synAccessSource=h5',
      'captcha_header_code=' + encodeURIComponent(code.trim()),
      'captcha_header_key=' + encodeURIComponent(key)
    ];
    return parts.join('&');
  }

  static safeRedirect(location: string, base: string): string {
    if (!location) {
      throw new ProtocolFailure('redirect', '学校单点登录缺少跳转地址');
    }
    let url = location.trim();
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url) &&
        !url.startsWith('https://') && !url.startsWith('http://')) {
      throw new ProtocolFailure('redirect', '已拒绝学校返回的非 HTTP 跳转协议');
    }
    if (url.indexOf('\\') >= 0 || /[\r\n]/.test(url)) {
      throw new ProtocolFailure('redirect', '跳转地址包含非法字符');
    }
    if (url.startsWith('//')) {
      url = 'https:' + url;
    } else if (url.startsWith('/')) {
      const scheme = base.indexOf('://');
      const slash = base.indexOf('/', scheme + 3);
      url = (slash < 0 ? base : base.substring(0, slash)) + url;
    } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
      const cleanBase = base.split('#')[0].split('?')[0];
      const slash = cleanBase.lastIndexOf('/');
      url = cleanBase.substring(0, slash + 1) + url;
    }
    if (url.startsWith('http://')) {
      url = 'https://' + url.substring(7);
    }
    const match = /^https:\/\/([a-zA-Z0-9.-]+)(?::443)?(?:[/?#]|$)/.exec(url);
    if (!match) {
      throw new ProtocolFailure('redirect', '学校单点登录返回了无效地址');
    }
    const host = match[1].toLowerCase();
    if (host !== 'scut.edu.cn' && !host.endsWith('.scut.edu.cn')) {
      throw new ProtocolFailure('redirect', '为保护会话，已拒绝跳转到校外网站');
    }
    return url;
  }

  static isDxcIndex(url: string): boolean {
    return url.split('?')[0].endsWith('/sdms-weixin-pay-sp/newWeixin/index.html');
  }

  static parseGzic(electric: GzicItem, ac: GzicItem, water: GzicItem): BalanceReading {
    if (electric.code !== 200 || ac.code !== 200 || water.code !== 200 ||
        !electric.map || !ac.map || !water.map) {
      throw new ProtocolFailure('gzic', '广州国际校区费用项返回异常');
    }
    const room = electric.map.data.room;
    const es = electric.map.showData.信息;
    const as = ac.map.showData.信息;
    const ws = water.map.showData.信息;
    const e = Protocol.extractNumber(es);
    const a = Protocol.extractNumber(as);
    const w = Protocol.extractNumber(ws.split(',').pop() ?? '');
    if (!room || e === null || a === null || w === null) {
      throw new ProtocolFailure('gzic', '学校费用项结构发生变化');
    }
    return {
      campus: 'GZIC', room: room, electric: e, water: w, ac: a,
      electricText: es, waterText: ws, acText: as, at: Date.now()
    };
  }

  static parseDxc(info: DxcReply, ammeter: DxcReply, water: DxcReply): BalanceReading {
    if (String(info.statusCode) !== '200' || String(ammeter.statusCode) !== '200' ||
        String(water.statusCode) !== '200') {
      throw new ProtocolFailure('dxc', '大学城缴费系统返回异常');
    }
    const room = info.resultObject?.roomName ?? '';
    const e = Protocol.money(ammeter);
    const w = Protocol.money(water);
    if (!room || e === null || w === null) {
      throw new ProtocolFailure('dxc', '学校未返回房间或余额');
    }
    return {
      campus: 'DXC', room: room, electric: e, water: w, ac: null,
      electricText: '元', waterText: '平台返回余额',
      acText: '大学城校区无空调费数据', at: Date.now()
    };
  }

  private static money(json: DxcReply): number | null {
    const raw = json.resultObject?.leftMoney;
    if (typeof raw !== 'number' && typeof raw !== 'string') {
      return null;
    }
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  private static extractNumber(raw: string): number | null {
    const match = /-?\d+(?:\.\d+)?/.exec(raw ?? '');
    return match === null ? null : Number(match[0]);
  }

  static snapshot(reading: BalanceReading): HistoryPoint {
    return {
      at: reading.at, campus: reading.campus, electric: reading.electric,
      water: reading.water, ac: reading.ac
    };
  }
}

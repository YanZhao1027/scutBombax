import { rcp } from '@kit.RemoteCommunicationKit';
import { SchoolHttp, SchoolReply } from './SchoolHttp';
import { Protocol } from './Protocol';
import {
  Campus, LoginType, SchoolCaptcha, KeyboardEnvelope, KeyboardData, LoginReply,
  FrontInfo, GzicItem, DxcReply, BalanceReading, ProtocolFailure
} from '../models/SchoolTypes';

const CARD = 'https://ecardwxnew.scut.edu.cn';
const DFYC = 'https://dfyc.utc.scut.edu.cn';

/** PUBLIC OAuth H5 client credential copied from the official school's own JS. */
const PUBLIC_H5_BASIC =
  'Basic bW9iaWxlX3NlcnZpY2VfcGxhdGZvcm06bW9iaWxlX3NlcnZpY2VfcGxhdGZvcm1fc2VjcmV0';

/**
 * One process-local school session. No password, OAuth token or cookies on disk,
 * no telemetry, no background network polling. Only requests initiated by user.
 */
export class SchoolClient {
  private http: SchoolHttp = new SchoolHttp();
  private accessToken: string = '';
  private validUntil: number = 0;
  private campus: Campus = 'DXC';
  private captchaKey: string = '';
  private dxcSessionReady: boolean = false;
  private busy: boolean = false;

  isLoggedIn(): boolean {
    return this.accessToken.length > 0 && Date.now() < this.validUntil - 300000;
  }

  async getCaptcha(): Promise<string> {
    this.captchaKey = '';
    const front = await this.http.get(CARD + '/berserker-app/frontInfo?synAccessSource=h5');
    const config = this.decode<FrontInfo>(front, 'frontInfo');
    if (config.code !== 200 || config.data?.platType !== 'h5') {
      throw new ProtocolFailure('frontInfo', '学校 H5 登录配置暂不可用');
    }
    const reply = await this.http.get(CARD + '/berserker-auth/oauth/captcha?synAccessSource=h5');
    const captcha = this.decode<SchoolCaptcha>(reply, 'captcha');
    if (!captcha.key || !captcha.image || captcha.image.length > 1000000) {
      throw new ProtocolFailure('captcha', '学校验证码结构发生变化');
    }
    this.captchaKey = captcha.key;
    // Image() understands data:image/png;base64,...; the key is never shown.
    return captcha.image.startsWith('data:') ? captcha.image :
      'data:image/png;base64,' + captcha.image;
  }

  async probe(): Promise<string> {
    const image = await this.getCaptcha();
    if (image.length < 40) {
      throw new ProtocolFailure('captcha', '验证码图片不完整');
    }
    const reply = await this.http.get(
      CARD + '/berserker-secure/keyboard?type=Standard&order=0&synAccessSource=h5'
    );
    const data = this.decode<KeyboardEnvelope>(reply, 'keyboard');
    this.checkedKeyboard(data);
    return '登录配置 ✓  验证码 ✓  安全键盘 ✓';
  }

  private checkedKeyboard(reply: KeyboardEnvelope): KeyboardData {
    const d = reply.data;
    if (reply.code !== 200 || !d?.uuid || !d.numberKeyboard ||
        !d.lowerLetterKeyboard || !d.upperLetterKeyboard || !d.symbolKeyboard) {
      throw new ProtocolFailure('keyboard', '学校安全键盘结构发生变化');
    }
    return d;
  }

  async login(
    username: string, password: string, captcha: string,
    campus: Campus, type: LoginType
  ): Promise<void> {
    if (this.busy) {
      throw new ProtocolFailure('login', '正在执行查询，请稍后');
    }
    if (!username.trim() || !password || !captcha.trim() || !this.captchaKey) {
      throw new ProtocolFailure('login', '请填写账号、查询密码及验证码');
    }
    if (type !== 'card' && type !== 'sno') {
      throw new ProtocolFailure('login', '请选择正确的登录账号类型');
    }
    this.busy = true;
    try {
      const keyboardResponse = await this.http.get(
        CARD + '/berserker-secure/keyboard?type=Standard&order=0&synAccessSource=h5'
      );
      const keyboard = this.checkedKeyboard(
        this.decode<KeyboardEnvelope>(keyboardResponse, 'keyboard')
      );
      const encoded = Protocol.encodeKeyboardPassword(password, keyboard);
      const body = Protocol.loginBody(username, encoded, this.captchaKey, captcha, type);
      this.captchaKey = '';
      const response = await this.http.post(
        CARD + '/berserker-auth/oauth/token', body, PUBLIC_H5_BASIC
      );
      const result = this.decode<LoginReply>(response, 'login');
      if (response.status !== 200 || !result.access_token) {
        const code = String(result.code ?? '-');
        const reason = code === '8002' || code === '8003'
          ? '验证码无效，请刷新'
          : code === '8000'
            ? '账号、登录类型或查询密码不正确'
            : '学校登录失败（业务码 ' + code + '），请刷新验证码';
        throw new ProtocolFailure('login', reason);
      }
      const lifetime = Number(result.expires_in ?? 0);
      if (!Number.isFinite(lifetime) || lifetime <= 0) {
        throw new ProtocolFailure('login', '学校未返回有效会话期限');
      }
      this.accessToken = result.access_token;
      this.validUntil = lifetime > 315360000
        ? lifetime : Date.now() + lifetime * 1000;
      this.campus = campus;
      this.dxcSessionReady = false;
      this.http.cookies.jsession = '';
    } finally {
      this.busy = false;
    }
  }

  async query(): Promise<BalanceReading> {
    if (this.busy) {
      throw new ProtocolFailure('query', '已有一个请求正在进行');
    }
    if (!this.isLoggedIn()) {
      throw new ProtocolFailure('query', '登录已过期，请重新登录');
    }
    this.busy = true;
    try {
      if (this.campus === 'GZIC') {
        return await this.queryGzic();
      }
      return await this.queryDxc();
    } finally {
      this.busy = false;
    }
  }

  private async queryGzic(): Promise<BalanceReading> {
    const header: rcp.RequestHeaders = { 'Synjones-Auth': 'bearer ' + this.accessToken };
    const base = CARD + '/charge/feeitem/getThirdDataByFeeItemId?feeitemid=';
    const suffix = '&synAccessSource=h5';
    const electric = this.decode<GzicItem>(
      await this.http.get(base + '1' + suffix, 'card', header), 'gzic-electric'
    );
    const ac = this.decode<GzicItem>(
      await this.http.get(base + '2' + suffix, 'card', header), 'gzic-ac'
    );
    const water = this.decode<GzicItem>(
      await this.http.get(base + '3' + suffix, 'card', header), 'gzic-water'
    );
    return Protocol.parseGzic(electric, ac, water);
  }

  private async queryDxc(): Promise<BalanceReading> {
    if (this.dxcSessionReady && this.http.cookies.jsession) {
      try {
        return await this.readDxc();
      } catch (e) {
        if (!(e instanceof ProtocolFailure)) {
          throw new ProtocolFailure('dxc', '缴费查询未完成，请检查学校网络');
        }
        if (e.stage !== 'dxc-session') {
          throw e;
        }
        this.dxcSessionReady = false;
        this.http.cookies.jsession = '';
      }
    }
    await this.establishDxc();
    return await this.readDxc();
  }

  private async establishDxc(): Promise<void> {
    const start = CARD + '/berserker-base/redirect?appId=360&loginFrom=h5' +
      '&synAccessSource=h5&synjones-auth=' + encodeURIComponent(this.accessToken) +
      '&type=app';
    const first = await this.http.get(start, 'sso');
    this.requireRedirect(first, 'dxc-redirect');
    const thirdUrl = Protocol.safeRedirect(first.location, start);
    const third = await this.http.get(thirdUrl, 'sso');
    this.requireRedirect(third, 'dxc-third');
    if (!this.http.cookies.jsession) {
      throw new ProtocolFailure('dxc-third', '大学城缴费系统未建立本机会话');
    }
    let nextUrl = Protocol.safeRedirect(third.location, thirdUrl);
    if (Protocol.isDxcIndex(nextUrl)) {
      this.dxcSessionReady = true;
      return;
    }
    const authorize = await this.http.get(nextUrl, 'sso');
    this.requireRedirect(authorize, 'dxc-authorize');
    nextUrl = Protocol.safeRedirect(authorize.location, nextUrl);
    const getCode = await this.http.get(nextUrl, 'sso');
    this.requireRedirect(getCode, 'dxc-getCode');
    const last = Protocol.safeRedirect(getCode.location, nextUrl);
    if (!Protocol.isDxcIndex(last)) {
      throw new ProtocolFailure('dxc-getCode', '学校单点登录未落到缴费首页');
    }
    this.dxcSessionReady = true;
  }

  private requireRedirect(reply: SchoolReply, stage: string): void {
    if (reply.status !== 302 || !reply.location) {
      throw new ProtocolFailure(stage, '单点登录跳转不符预期（HTTP ' + reply.status + '）');
    }
  }

  private async readDxc(): Promise<BalanceReading> {
    const info = this.readDxcJson(
      await this.http.get(DFYC + '/sdms-weixin-pay-sp/service/find/userinfo', 'dxc'), 'user'
    );
    const ammeter = this.readDxcJson(
      await this.http.get(DFYC + '/sdms-weixin-pay-sp/service/ammeterBalance?type=1', 'dxc'), 'electric'
    );
    const water = this.readDxcJson(
      await this.http.get(DFYC + '/sdms-weixin-pay-sp/service/waterBalance?type=3&systemType=1', 'dxc'),
      'water'
    );
    return Protocol.parseDxc(info, ammeter, water);
  }

  private readDxcJson(reply: SchoolReply, stage: string): DxcReply {
    if (reply.status === 302 || reply.status === 401 || reply.status === 403) {
      throw new ProtocolFailure('dxc-session', '缴费会话已失效');
    }
    return this.decode<DxcReply>(reply, 'dxc-' + stage);
  }

  private decode<T>(response: SchoolReply, stage: string): T {
    if (response.status === 403) {
      throw new ProtocolFailure(stage, '学校限制当前网络，请连接校园网或官方 SSLVPN');
    }
    if (response.status < 200 || response.status >= 300) {
      throw new ProtocolFailure(stage, '学校接口异常（HTTP ' + response.status + '）');
    }
    try {
      return JSON.parse(response.text) as T;
    } catch (_) {
      throw new ProtocolFailure(stage, '学校返回内容无法解析');
    }
  }

  logout(): void {
    this.http.close();
    this.http = new SchoolHttp();
    this.accessToken = '';
    this.validUntil = 0;
    this.captchaKey = '';
    this.dxcSessionReady = false;
    this.busy = false;
  }
}

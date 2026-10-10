import { rcp } from '@kit.RemoteCommunicationKit';
import { buffer } from '@kit.ArkTS';
import { Protocol } from './Protocol';
import { ProtocolFailure } from '../models/SchoolTypes';

export interface SchoolReply {
  status: number;
  text: string;
  location: string;
}

/** In-memory only, intentionally not persisted in Preferences or logged. */
export class SchoolCookies {
  tgc: string = '';
  locSession: string = '';
  errorTimes: string = '';
  jsession: string = '';

  add(response: rcp.Response): void {
    for (const item of response.cookies ?? []) {
      this.accept(item.name, item.value ?? '');
    }
    // Compatibility: some schools omit domains or use multiple Set-Cookie headers.
    const header = response.headers['set-cookie'];
    if (typeof header === 'string') {
      this.acceptHeader(header);
    } else if (header) {
      for (const line of header) {
        this.acceptHeader(line);
      }
    }
  }

  private acceptHeader(line: string): void {
    const accepted = /(TGC|locSession|error_times|JSESSIONID)=([^;, \r\n]*)/g;
    let match: RegExpExecArray | null = accepted.exec(line);
    while (match !== null) {
      this.accept(match[1], match[2]);
      match = accepted.exec(line);
    }
  }

  private accept(name: string, value: string): void {
    if (!value) {
      return;
    }
    switch (name) {
      case 'TGC': this.tgc = value; break;
      case 'locSession': this.locSession = value; break;
      case 'error_times': this.errorTimes = value; break;
      case 'JSESSIONID': this.jsession = value; break;
    }
  }

  forCard(): rcp.RequestCookies {
    const data: rcp.RequestCookies = {};
    if (this.tgc) data['TGC'] = this.tgc;
    if (this.locSession) data['locSession'] = this.locSession;
    if (this.errorTimes) data['error_times'] = this.errorTimes;
    return data;
  }

  forDxc(): rcp.RequestCookies {
    const data: rcp.RequestCookies = {};
    if (this.jsession) data['JSESSIONID'] = this.jsession;
    return data;
  }

  forSso(): rcp.RequestCookies {
    const data: rcp.RequestCookies = this.forCard();
    if (this.jsession) data['JSESSIONID'] = this.jsession;
    return data;
  }

  clear(): void {
    this.tgc = '';
    this.locSession = '';
    this.errorTimes = '';
    this.jsession = '';
  }
}

/** Explicitly disables redirects so token/cookie-bearing SSO hops are audited. */
export class SchoolHttp {
  private session: rcp.Session = rcp.createSession({
    requestConfiguration: {
      transfer: {
        autoRedirect: false,
        timeout: {
          connectMs: 10000,
          transferMs: 25000
        }
      }
    }
  });
  readonly cookies: SchoolCookies = new SchoolCookies();

  async get(url: string, kind: string = 'card', extraHeaders: rcp.RequestHeaders = {}): Promise<SchoolReply> {
    return await this.send(url, 'GET', '', extraHeaders, kind);
  }

  async post(url: string, body: string, authorization: string): Promise<SchoolReply> {
    const headers: rcp.RequestHeaders = {
      'authorization': authorization,
      'content-type': 'application/x-www-form-urlencoded'
    };
    return await this.send(url, 'POST', body, headers, 'card');
  }

  private async send(
    url: string, method: string, body: string, extraHeaders: rcp.RequestHeaders, kind: string
  ): Promise<SchoolReply> {
    const target = Protocol.safeRedirect(url, url);
    const request = new rcp.Request(target, method);
    const headers: rcp.RequestHeaders = {
      'accept': 'application/json, text/plain, */*',
      'accept-language': 'zh-CN,zh;q=0.9',
      'user-agent': 'Mozilla/5.0 (Linux; HarmonyOS 5; Mobile) AppleWebKit/537.36 Mobile Safari/537.36'
    };
    if (extraHeaders['authorization']) {
      headers['authorization'] = extraHeaders['authorization'];
    }
    if (extraHeaders['content-type']) {
      headers['content-type'] = extraHeaders['content-type'];
    }
    if (extraHeaders['Synjones-Auth']) {
      headers['Synjones-Auth'] = extraHeaders['Synjones-Auth'];
    }
    request.headers = headers;
    if (kind === 'dxc') {
      request.cookies = this.cookies.forDxc();
    } else if (kind === 'sso') {
      request.cookies = this.cookies.forSso();
    } else {
      request.cookies = this.cookies.forCard();
    }
    if (method === 'POST') {
      request.content = body;
    }
    request.configuration = {
      transfer: {
        autoRedirect: false,
        timeout: { connectMs: 10000, transferMs: 25000 }
      }
    };
    const response = await this.session.fetch(request);
    this.cookies.add(response);
    const raw = response.body;
    if (raw !== undefined && raw.byteLength > 1_500_000) {
      throw new ProtocolFailure('http', '学校响应超过安全大小限制');
    }
    const text = raw === undefined ? '' : buffer.from(raw).toString('utf8');
    const locationValue = response.headers['location'];
    const location = typeof locationValue === 'string' ? locationValue : '';
    return { status: response.statusCode, text: text, location: location };
  }

  close(): void {
    this.session.close();
    this.cookies.clear();
  }
}

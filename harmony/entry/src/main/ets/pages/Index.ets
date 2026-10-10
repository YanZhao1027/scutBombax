import { common } from '@kit.AbilityKit';
import { SchoolClient } from '../services/SchoolClient';
import { HistoryStore } from '../services/HistoryStore';
import { BalanceTrend } from '../components/BalanceTrend';
import { BalanceReading, HistoryPoint, Campus, LoginType, ProtocolFailure } from '../models/SchoolTypes';

@Entry
@Component
struct Index {
  @State private username: string = '';
  @State private password: string = '';
  @State private captchaCode: string = '';
  @State private captchaImage: string = '';
  @State private campusIndex: number = 0;
  @State private loginTypeIndex: number = 1;
  @State private working: boolean = false;
  @State private loggedIn: boolean = false;
  @State private reading: BalanceReading | null = null;
  @State private history: HistoryPoint[] = [];
  @State private trendDays: number = 30;
  @State private status: string = '请连接校园网或学校官方 SSLVPN，获取验证码后登录。';
  @State private stage: string = '未连接';

  private school: SchoolClient = new SchoolClient();
  private storage: HistoryStore = new HistoryStore();

  aboutToAppear(): void {
    this.loadHistory();
  }

  private async loadHistory(): Promise<void> {
    try {
      const context = getContext(this) as common.UIAbilityContext;
      this.history = await this.storage.init(context);
    } catch (_) {
      this.status = '本机历史暂不可用；不会影响学校查询。';
    }
  }

  private campus(): Campus {
    return this.campusIndex === 0 ? 'DXC' : 'GZIC';
  }

  private loginType(): LoginType {
    return this.loginTypeIndex === 0 ? 'card' : 'sno';
  }

  private reason(error: Object): string {
    if (error instanceof ProtocolFailure) {
      return error.publicReason;
    }
    return '请求未完成，请检查学校网络或稍后重试。';
  }

  private async refreshCaptcha(): Promise<void> {
    if (this.working) return;
    this.working = true;
    this.stage = '请求验证码';
    this.captchaImage = '';
    this.captchaCode = '';
    try {
      this.captchaImage = await this.school.getCaptcha();
      this.stage = '验证码已就绪';
      this.status = '请输入图片验证码和查询密码。密码不会离开本机直接以学校规定的编码形式提交。';
    } catch (e) {
      this.stage = '验证码失败';
      this.status = this.reason(e as Object);
    } finally {
      this.working = false;
    }
  }

  private async runProbe(): Promise<void> {
    if (this.working) return;
    this.working = true;
    this.stage = '检查网络';
    try {
      const report = await this.school.probe();
      this.status = report;
      this.stage = '协议探针通过';
      this.captchaImage = '';
      this.captchaCode = '';
    } catch (e) {
      this.stage = '协议探针待排查';
      this.status = this.reason(e as Object);
    } finally {
      this.working = false;
    }
  }

  private async doLogin(): Promise<void> {
    if (this.working) return;
    const username = this.username;
    const secret = this.password;
    const code = this.captchaCode;
    this.password = ''; // Clear reactive UI state before any asynchronous network work.
    this.captchaCode = '';
    this.working = true;
    this.stage = '正在登录';
    try {
      await this.school.login(username, secret, code, this.campus(), this.loginType());
      this.loggedIn = true;
      this.captchaImage = '';
      this.stage = '已登录';
      this.status = '学校验证成功。点击“查询水电余额”获取最新数值。';
    } catch (e) {
      this.loggedIn = false;
      this.stage = '登录未成功';
      this.status = this.reason(e as Object);
      this.captchaImage = '';
    } finally {
      this.working = false;
    }
  }

  private async refreshBalance(): Promise<void> {
    if (this.working) return;
    this.working = true;
    this.stage = '查询余额中';
    try {
      const next = await this.school.query();
      this.reading = next;
      this.stage = '查询成功';
      this.status = '查询结果来自华工官方接口，仅保存在本机。';
      try {
        this.history = await this.storage.append(next);
      } catch (_) {
        this.status = '查询成功，但保存本机历史失败；余额仍可查看。';
      }
    } catch (e) {
      this.stage = '查询未成功';
      this.status = this.reason(e as Object);
    } finally {
      this.working = false;
    }
  }

  private logout(): void {
    if (this.working) return;
    this.school.logout();
    this.loggedIn = false;
    this.password = '';
    this.captchaCode = '';
    this.captchaImage = '';
    this.username = '';
    this.reading = null;
    this.stage = '已退出';
    this.status = '账号、令牌与 Cookie 已从应用内存清除。本机余额历史仍保留。';
  }

  private async clearHistory(): Promise<void> {
    if (this.working) return;
    this.working = true;
    try {
      await this.storage.clear();
      this.history = [];
      this.status = '已清除本机余额历史。';
    } catch (_) {
      this.status = '清除失败，请稍后重试。';
    } finally {
      this.working = false;
    }
  }

  @Builder
  private balanceBox(name: string, value: number, unit: string) {
    Column({ space: 6 }) {
      Text(name)
        .fontSize(13)
        .fontColor('#677E97')
      Text(value.toFixed(2))
        .fontSize(26)
        .fontWeight(FontWeight.Bold)
        .fontColor('#194A75')
      Text(unit)
        .fontSize(11)
        .fontColor('#677E97')
    }
    .padding(13)
    .layoutWeight(1)
    .backgroundColor('#EFF7FE')
    .borderRadius(14)
  }

  @Builder
  private historyRow(row: HistoryPoint) {
    Row({ space: 10 }) {
      Column({ space: 5 }) {
        Text(new Date(row.at).toLocaleString())
          .fontSize(11)
          .fontColor('#788BA0')
        Text(row.campus === 'DXC' ? '大学城校区' : '广州国际校区')
          .fontSize(11)
          .fontColor('#8799AB')
      }
      .layoutWeight(1)
      Text('电 ' + row.electric.toFixed(2))
        .fontSize(13)
        .fontColor('#194A75')
      Text('水 ' + row.water.toFixed(2))
        .fontSize(13)
        .fontColor('#147F93')
    }
    .width('100%')
    .padding({ top: 9, bottom: 9 })
  }

  build() {
    Column() {
      Scroll() {
        Column({ space: 16 }) {
          Row({ space: 12 }) {
            Image($r('app.media.icon'))
              .width(48)
              .height(48)
              .borderRadius(12)
            Column({ space: 5 }) {
              Text('花工木棉')
                .fontSize(25)
                .fontWeight(FontWeight.Bold)
                .fontColor('#164C7B')
              Text('HarmonyOS 本机校园水电查询')
                .fontSize(12)
                .fontColor('#60809A')
            }
            .alignItems(HorizontalAlign.Start)
          }
          .width('100%')

          Column({ space: 8 }) {
            Row() {
              Text('连接状态')
                .fontSize(13)
                .fontWeight(FontWeight.Medium)
              Blank()
              Text(this.stage)
                .fontSize(12)
                .fontColor('#126B98')
            }
            .width('100%')
            Text(this.status)
              .fontSize(12)
              .lineHeight(19)
              .fontColor('#5C728A')
              .width('100%')
          }
          .padding(15)
          .backgroundColor('#E7F3FC')
          .borderRadius(14)
          .width('100%')

          if (!this.loggedIn) {
            Column({ space: 13 }) {
              Row() {
                Text('校园卡登录')
                  .fontSize(18)
                  .fontWeight(FontWeight.Bold)
                  .fontColor('#1A4D79')
                Blank()
                Button('检查接口')
                  .fontSize(12)
                  .type(ButtonType.Capsule)
                  .backgroundColor('#DDECF8')
                  .fontColor('#195C8D')
                  .enabled(!this.working)
                  .onClick(() => { this.runProbe(); })
              }
              .width('100%')

              Text('校区')
                .fontColor('#526C86')
                .fontSize(12)
                .width('100%')
              Row({ space: 8 }) {
                Button('大学城')
                  .layoutWeight(1)
                  .fontSize(13)
                  .backgroundColor(this.campusIndex === 0 ? '#1676BD' : '#DFEAF4')
                  .fontColor(this.campusIndex === 0 ? '#FFFFFF' : '#345673')
                  .onClick(() => { this.campusIndex = 0; })
                Button('广州国际')
                  .layoutWeight(1)
                  .fontSize(13)
                  .backgroundColor(this.campusIndex === 1 ? '#1676BD' : '#DFEAF4')
                  .fontColor(this.campusIndex === 1 ? '#FFFFFF' : '#345673')
                  .onClick(() => { this.campusIndex = 1; })
              }
              Text('登录类型')
                .fontColor('#526C86')
                .fontSize(12)
                .width('100%')
              Row({ space: 8 }) {
                Button('一卡通账号')
                  .layoutWeight(1)
                  .fontSize(13)
                  .backgroundColor(this.loginTypeIndex === 0 ? '#1676BD' : '#DFEAF4')
                  .fontColor(this.loginTypeIndex === 0 ? '#FFFFFF' : '#345673')
                  .onClick(() => { this.loginTypeIndex = 0; })
                Button('学工号')
                  .layoutWeight(1)
                  .fontSize(13)
                  .backgroundColor(this.loginTypeIndex === 1 ? '#1676BD' : '#DFEAF4')
                  .fontColor(this.loginTypeIndex === 1 ? '#FFFFFF' : '#345673')
                  .onClick(() => { this.loginTypeIndex = 1; })
              }

              TextInput({ placeholder: '一卡通账号 / 学工号', text: this.username })
                .onChange((value: string) => { this.username = value; })
                .backgroundColor('#F1F5FA')
                .height(46)
              TextInput({ placeholder: '一卡通查询密码（非统一认证密码）', text: this.password })
                .type(InputType.Password)
                .onChange((value: string) => { this.password = value; })
                .backgroundColor('#F1F5FA')
                .height(46)

              Row({ space: 12 }) {
                if (this.captchaImage.length > 0) {
                  Image(this.captchaImage)
                    .objectFit(ImageFit.Contain)
                    .height(66)
                    .layoutWeight(1)
                } else {
                  Text('请先获取验证码')
                    .fontSize(12)
                    .fontColor('#8C9BAC')
                    .layoutWeight(1)
                }
                Button('刷新验证码')
                  .fontSize(12)
                  .backgroundColor('#DDECF8')
                  .fontColor('#195C8D')
                  .enabled(!this.working)
                  .onClick(() => { this.refreshCaptcha(); })
              }
              .height(72)
              .width('100%')

              TextInput({ placeholder: '请输入图片中的字符', text: this.captchaCode })
                .onChange((value: string) => { this.captchaCode = value; })
                .backgroundColor('#F1F5FA')
                .height(46)

              Button(this.working ? '处理中…' : '本机登录')
                .width('100%')
                .height(46)
                .backgroundColor('#1676BD')
                .enabled(!this.working)
                .onClick(() => { this.doLogin(); })
            }
            .width('100%')
            .padding(16)
            .backgroundColor('#FFFFFF')
            .borderRadius(18)
          } else {
            Column({ space: 14 }) {
              Row() {
                Text('宿舍水电余额')
                  .fontSize(18)
                  .fontWeight(FontWeight.Bold)
                  .fontColor('#194A75')
                Blank()
                Button('退出')
                  .fontSize(12)
                  .backgroundColor('#EEF3F8')
                  .fontColor('#56748B')
                  .onClick(() => { this.logout(); })
              }
              .width('100%')
              if (this.reading !== null) {
                Text(this.reading.room)
                  .fontSize(14)
                  .fontColor('#5D758A')
                  .width('100%')
                Row({ space: 12 }) {
                  this.balanceBox('电费余额', this.reading.electric, this.reading.electricText)
                  this.balanceBox('水费余额', this.reading.water, this.reading.waterText)
                }
                if (this.reading.ac !== null) {
                  Row() {
                    Text('空调费余额')
                      .fontSize(14)
                      .fontColor('#5D758A')
                    Blank()
                    Text(this.reading.ac.toFixed(2))
                      .fontSize(14)
                      .fontColor('#5D758A')
                  }
                }
              } else {
                Text('已经登录，点击下方按钮查询最新水电余额。')
                  .fontSize(13)
                  .fontColor('#687E91')
                  .width('100%')
              }
              Button(this.working ? '正在查询…' : '查询水电余额')
                .height(48)
                .width('100%')
                .backgroundColor('#1676BD')
                .enabled(!this.working)
                .onClick(() => { this.refreshBalance(); })
            }
            .padding(16)
            .backgroundColor('#FFFFFF')
            .borderRadius(18)
            .width('100%')
          }

          Column({ space: 11 }) {
            Row() {
              Text('本机历史')
                .fontSize(18)
                .fontWeight(FontWeight.Bold)
                .fontColor('#194A75')
              Blank()
              Text(String(this.history.length) + ' 条')
                .fontSize(12)
                .fontColor('#8293A5')
              Button('清空')
                .fontSize(12)
                .backgroundColor('#EEF3F8')
                .fontColor('#56748B')
                .enabled(!this.working)
                .onClick(() => { this.clearHistory(); })
            }
            .width('100%')

            if (this.history.length > 0) {
              Row({ space: 8 }) {
                Button('7天').fontSize(12)
                  .backgroundColor(this.trendDays === 7 ? '#1676BD' : '#DFEAF4')
                  .fontColor(this.trendDays === 7 ? '#FFFFFF' : '#345673')
                  .onClick(() => { this.trendDays = 7; })
                Button('30天').fontSize(12)
                  .backgroundColor(this.trendDays === 30 ? '#1676BD' : '#DFEAF4')
                  .fontColor(this.trendDays === 30 ? '#FFFFFF' : '#345673')
                  .onClick(() => { this.trendDays = 30; })
                Button('90天').fontSize(12)
                  .backgroundColor(this.trendDays === 90 ? '#1676BD' : '#DFEAF4')
                  .fontColor(this.trendDays === 90 ? '#FFFFFF' : '#345673')
                  .onClick(() => { this.trendDays = 90; })
              }
              BalanceTrend({ points: this.history, days: this.trendDays })
              Text('两张折线分别使用独立纵轴，仅用于观察各自余额变化。')
                .fontSize(11)
                .fontColor('#8397A8')
            }

            if (this.history.length === 0) {
              Text('暂无查询记录。每次成功查询后，金额及时间仅保存到本机。')
                .fontSize(12)
                .fontColor('#899AAA')
                .width('100%')
            } else {
              ForEach(this.history.slice(-10).reverse(), (row: HistoryPoint) => {
                this.historyRow(row)
              }, (row: HistoryPoint) => String(row.at))
            }
          }
          .width('100%')
          .padding(16)
          .backgroundColor('#FFFFFF')
          .borderRadius(18)

          Text('学生独立实验 · 非学校官方应用。账号密码只在本机录入，并仅提交给学校接口；令牌和 Cookie 只存在本机内存，不经过 Ubuntu / Cloudflare，也不后台定时查询。余额历史在本机保存。')
            .fontSize(11)
            .fontColor('#8194A7')
            .lineHeight(19)
            .width('100%')
        }
        .width('100%')
        .padding(16)
      }
      .scrollBar(BarState.Off)
      .width('100%')
      .height('100%')
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#F2F7FB')
  }
}

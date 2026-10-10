import { HistoryPoint } from '../models/SchoolTypes';

@Component
export struct BalanceTrend {
  @Watch('draw') @Prop points: HistoryPoint[] = [];
  @Watch('draw') @Prop days: number = 30;

  private settings: RenderingContextSettings = new RenderingContextSettings(true);
  private ctx: CanvasRenderingContext2D = new CanvasRenderingContext2D(this.settings);
  private initialized: boolean = false;

  private drawLine(
    readings: HistoryPoint[], electric: boolean, top: number, height: number,
    width: number, color: string
  ): void {
    const left = 14;
    const right = Math.max(left + 20, width - 16);
    const bottom = top + height;
    const values: number[] = readings.map((p: HistoryPoint): number =>
      electric ? p.electric : p.water
    );
    let low = Math.min(...values);
    let high = Math.max(...values);
    if (high === low) {
      high += 0.5;
      low -= 0.5;
    } else {
      const margin = (high - low) * 0.12;
      low -= margin;
      high += margin;
    }

    this.ctx.strokeStyle = '#E3EAF1';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(left, top + height / 2);
    this.ctx.lineTo(right, top + height / 2);
    this.ctx.stroke();

    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 2.4;
    this.ctx.beginPath();
    const first = readings[0].at;
    const last = readings[readings.length - 1].at;
    for (let i = 0; i < readings.length; i++) {
      const x = readings.length === 1 ? (left + right) / 2 :
        left + (readings[i].at - first) / Math.max(1, last - first) * (right - left);
      const y = bottom - (values[i] - low) / (high - low) * height;
      if (i === 0) {
        this.ctx.moveTo(x, y);
      } else {
        this.ctx.lineTo(x, y);
      }
    }
    this.ctx.stroke();
    this.ctx.fillStyle = color;
    const latest = values[values.length - 1];
    this.ctx.font = '12px sans-serif';
    this.ctx.textAlign = 'left';
    this.ctx.fillText(
      (electric ? '电费 ' : '水费 ') + latest.toFixed(2), left + 3, top + 13
    );
  }

  private draw(): void {
    if (!this.initialized || this.ctx.width < 60) {
      return;
    }
    const width = this.ctx.width;
    const height = this.ctx.height;
    this.ctx.clearRect(0, 0, width, height);
    const cutoff = Date.now() - this.days * 86400000;
    const campus = this.points.length > 0 ? this.points[this.points.length - 1].campus : 'DXC';
    const recent = this.points.filter((p: HistoryPoint): boolean =>
      p.at >= cutoff && p.campus === campus
    ).sort((a: HistoryPoint, b: HistoryPoint): number => a.at - b.at)
      .slice(-120);
    if (recent.length === 0) {
      this.ctx.fillStyle = '#8194A7';
      this.ctx.font = '12px sans-serif';
      this.ctx.fillText('此时间范围还没有余额记录', 14, height / 2);
      return;
    }
    const lane = (height - 40) / 2;
    this.drawLine(recent, true, 7, lane, width, '#1676BD');
    this.drawLine(recent, false, lane + 29, lane, width, '#1393A9');
  }

  build() {
    Canvas(this.ctx)
      .width('100%')
      .height(182)
      .onReady((): void => {
        this.initialized = true;
        this.draw();
      })
  }
}

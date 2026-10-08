import type { ElectricHistory, ElectricHistoryPoint } from './types';

/**
 * The electricity trend, drawn as one inline SVG.
 *
 * Everything here is a read of the local SQLite history that `BillingRepository` already wrote.
 * No path in this file can reach the school: the chart is what makes the nightly sample worth
 * having, and it would be a poor trade if viewing it cost the school another request.
 *
 * The pure parts — which points belong to a range, where the line must break, which readings look
 * like a top-up — are exported and unit-tested, because those are the claims that would be
 * expensive to get wrong: a line drawn across a three-day hole invents consumption that never
 * happened, and a "recharge" inferred from a balance rise is an inference, not an event.
 */

/** The DOM the renderer needs. Passed in so the module never looks elements up by itself. */
export interface TrendNodes {
  svg: SVGSVGElement;
  summary: HTMLElement;
  selected: HTMLElement;
  increases: HTMLUListElement;
  empty: HTMLElement;
}

const DAY_MS = 86_400_000;

/**
 * A gap longer than this is a hole in the record, not a slow day, and the line must break across
 * it. 1.8 days is deliberately just above the nightly cadence: a sample that arrives late in the
 * evening (the alarm is inexact, and Doze has been measured delaying it by minutes to hours) is
 * still the same continuous series, while a missing day is drawn as a missing day.
 */
export const GAP_BREAK_MS = 1.8 * DAY_MS;

/** Drawing constants, in the SVG's own viewBox units. */
const WIDTH = 360;
const HEIGHT = 224;
const PAD_LEFT = 47;
const PAD_RIGHT = 12;
const PAD_TOP = 16;
const PAD_BOTTOM = 34;
const GRID_LINES = 5;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Dates on the axis are in the dormitory's own day, not the device's. */
const dayFormat = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: 'numeric',
  day: 'numeric'
});
const timeFormat = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
});

const formatDay = (millis: number): string => dayFormat.format(new Date(millis));
const formatMoment = (millis: number): string => timeFormat.format(new Date(millis));

/**
 * A money balance gets a currency sign; anything else says what it is.
 *
 * The unit arrives from the stored row, so a reading taken while the unit was still unverified
 * keeps displaying honestly instead of being dressed up as ¥ by a later confirmation.
 */
const amount = (value: number, unit: string): string =>
  unit === '元' ? `¥${value.toFixed(2)}` : `${value.toFixed(2)}${unit ? ` ${unit}` : ''}`;

/**
 * The points to plot for a range, oldest first, with unusable rows dropped.
 *
 * A reading with no electricity figure is not a zero and not a straight line to the next point —
 * it is absent, and plotting it would invent a cliff.
 */
export function filterElectricHistory(
  history: ElectricHistory,
  range: number | 'all'
): ElectricHistoryPoint[] {
  const rows = history.points
    .filter(
      (point) =>
        point.electric !== null &&
        Number.isFinite(point.electric) &&
        Number.isFinite(point.updatedAt) &&
        point.updatedAt > 0
    )
    .sort((a, b) => a.updatedAt - b.updatedAt);
  if (rows.length === 0 || range === 'all') return rows;
  const cutoff = rows[rows.length - 1].updatedAt - range * DAY_MS;
  return rows.filter((point) => point.updatedAt >= cutoff);
}

/**
 * True when the line must not connect `previousAt` to `currentAt`.
 *
 * The first point of a series breaks by definition — there is nothing to the left of it — and a
 * hole longer than [GAP_BREAK_MS] breaks too, so a week with no sample shows as a week with no
 * line rather than as a steady decline the school never reported.
 */
export function breaksTheLine(previousAt: number | null, currentAt: number): boolean {
  if (previousAt === null) return true;
  return currentAt - previousAt > GAP_BREAK_MS;
}

/**
 * Readings where the balance went up.
 *
 * Deliberately called an *increase*, not a recharge: the delta is whatever the balance moved, and
 * a platform adjustment or a quota correction looks identical from here. Turning these into
 * "充值 +¥50" would be claiming knowledge the answer does not give.
 */
export function balanceIncreases(
  points: ElectricHistoryPoint[]
): Array<{ at: number; delta: number }> {
  const out: Array<{ at: number; delta: number }> = [];
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1].electric;
    const current = points[i].electric;
    if (previous !== null && current !== null && current > previous) {
      out.push({ at: points[i].updatedAt, delta: current - previous });
    }
  }
  return out;
}

function svgElement(
  name: string,
  attrs: Record<string, string | number>,
  text?: string
): SVGElement {
  const node = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Draws (or redraws) the trend. Called on open, on range change, and after any new reading. */
export function drawElectricTrend(
  nodes: TrendNodes,
  history: ElectricHistory,
  range: number | 'all'
): void {
  const full = filterElectricHistory(history, 'all');
  const points = filterElectricHistory(history, range);

  nodes.svg.replaceChildren();
  nodes.increases.replaceChildren();
  nodes.empty.hidden = full.length !== 0;

  if (points.length === 0) {
    nodes.summary.textContent = '暂无本地电费读数';
    nodes.selected.textContent = '';
    return;
  }
  nodes.summary.textContent =
    points.length < 4 ? '正在积累历史读数' : `本地历史 · 最近 ${points.length} 条记录`;

  const minTime = points[0].updatedAt;
  const maxTime = points[points.length - 1].updatedAt;
  const minValue = Math.min(0, ...points.map((p) => p.electric as number));
  const maxValue = Math.max(1, ...points.map((p) => p.electric as number));
  // Round the top of the axis up to a whole 5 so the grid labels stay readable, and keep the
  // x-axis at least a day wide so a single reading does not collapse onto the y-axis.
  const ceiling = Math.ceil(maxValue / 5) * 5 || 5;
  const span = Math.max(DAY_MS, maxTime - minTime);
  const x = (time: number): number => PAD_LEFT + ((time - minTime) / span) * (WIDTH - PAD_LEFT - PAD_RIGHT);
  const y = (value: number): number =>
    PAD_TOP + ((ceiling - value) / (ceiling - minValue || 1)) * (HEIGHT - PAD_TOP - PAD_BOTTOM);

  for (let i = 0; i < GRID_LINES; i++) {
    const value = ceiling - ((ceiling - minValue) * i) / (GRID_LINES - 1);
    const line = y(value);
    nodes.svg.append(
      svgElement('line', { x1: PAD_LEFT, x2: WIDTH - PAD_RIGHT, y1: line, y2: line, class: 'grid' })
    );
    nodes.svg.append(
      svgElement(
        'text',
        { x: PAD_LEFT - 7, y: line + 4, 'text-anchor': 'end', class: 'axis-label' },
        value.toFixed(value % 1 ? 1 : 0)
      )
    );
  }

  // Increases are found across the whole record, then shown where they fall in the range: an
  // top-up just to the left of a 7-day window is still the reason the first point is high.
  const increases = balanceIncreases(full);
  const increasedAt = new Set(increases.map((item) => item.at));

  let path = '';
  points.forEach((point, i) => {
    const command = breaksTheLine(i === 0 ? null : points[i - 1].updatedAt, point.updatedAt)
      ? 'M'
      : 'L';
    path += `${command}${x(point.updatedAt).toFixed(2)},${y(point.electric as number).toFixed(2)} `;
  });
  nodes.svg.append(svgElement('path', { d: path, class: 'line' }));

  points.forEach((point) => {
    if (increasedAt.has(point.updatedAt)) {
      nodes.svg.append(
        svgElement('circle', {
          cx: x(point.updatedAt),
          cy: y(point.electric as number),
          r: 5,
          class: 'increase'
        })
      );
    }
  });

  nodes.svg.append(
    svgElement('text', { x: PAD_LEFT, y: HEIGHT - 8, class: 'axis-label' }, formatDay(minTime))
  );
  nodes.svg.append(
    svgElement(
      'text',
      { x: WIDTH - PAD_RIGHT, y: HEIGHT - 8, 'text-anchor': 'end', class: 'axis-label' },
      formatDay(maxTime)
    )
  );

  const guide = svgElement('line', {
    x1: 0,
    x2: 0,
    y1: PAD_TOP,
    y2: HEIGHT - PAD_BOTTOM,
    class: 'focus-guide'
  });
  const marker = svgElement('circle', { cx: 0, cy: 0, r: 5, class: 'focus' });
  nodes.svg.append(guide, marker);

  let selected = points.length - 1;
  const pick = (index: number): void => {
    selected = Math.max(0, Math.min(points.length - 1, index));
    const point = points[selected];
    const at = x(point.updatedAt);
    guide.setAttribute('x1', String(at));
    guide.setAttribute('x2', String(at));
    marker.setAttribute('cx', String(at));
    marker.setAttribute('cy', String(y(point.electric as number)));
    // The text line is the accessible version of the chart: a screen reader gets the same reading
    // a finger does, and `aria-live` announces it as the selection moves.
    nodes.selected.textContent = `${formatMoment(point.updatedAt)}  ${amount(
      point.electric as number,
      history.unit
    )}`;
  };

  const nearestIndex = (clientX: number): number => {
    const rect = nodes.svg.getBoundingClientRect();
    const target = ((clientX - rect.left) / rect.width) * WIDTH;
    let best = 0;
    for (let i = 1; i < points.length; i++) {
      if (
        Math.abs(x(points[i].updatedAt) - target) < Math.abs(x(points[best].updatedAt) - target)
      ) {
        best = i;
      }
    }
    return best;
  };

  nodes.svg.onpointerdown = (event) => {
    pick(nearestIndex(event.clientX));
    nodes.svg.setPointerCapture?.(event.pointerId);
  };
  nodes.svg.onpointermove = (event) => {
    // Only while a finger or the mouse button is down; `touch-action: pan-y` in the stylesheet is
    // what lets a vertical swipe still scroll the page.
    if (event.buttons !== 0) pick(nearestIndex(event.clientX));
  };
  nodes.svg.onkeydown = (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      pick(selected + (event.key === 'ArrowLeft' ? -1 : 1));
    }
  };
  pick(selected);

  increases
    .filter((item) => points.some((point) => point.updatedAt === item.at))
    .reverse()
    .forEach((item) => {
      const row = document.createElement('li');
      const date = document.createElement('span');
      date.textContent = formatDay(item.at);
      const delta = document.createElement('span');
      delta.textContent = `+${amount(item.delta, history.unit)}`;
      row.append(date, delta);
      nodes.increases.append(row);
    });

  if (nodes.increases.children.length === 0) {
    const row = document.createElement('li');
    row.textContent = '暂无余额增项';
    nodes.increases.append(row);
  }
}

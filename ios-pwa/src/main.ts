import './styles.css';
import { drawElectricTrend } from '../../src/trend';
import type { ElectricHistory, ElectricHistoryPoint } from '../../src/types';
import {
  MAX_IMPORT_BYTES, clearHistory, demoHistory, formatBackup,
  parseBackup, parseManualMoney, readHistory, saveReadings,
  type Reading,
} from './storage';

const $ = <T extends Element>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error('缺少界面组件 ' + id);
  return node as unknown as T;
};

const ui = {
  connection: $<HTMLSpanElement>('connection'),
  electric: $<HTMLParagraphElement>('electric'),
  water: $<HTMLElement>('water'),
  updated: $<HTMLElement>('last-updated'),
  demoBanner: $<HTMLDivElement>('demo-banner'),
  demoButton: $<HTMLButtonElement>('demo-button'),
  trendSvg: $<SVGSVGElement>('trend-svg'),
  trendSummary: $<HTMLElement>('trend-summary'),
  trendSelected: $<HTMLElement>('trend-selected'),
  trendIncreases: $<HTMLUListElement>('trend-increases'),
  trendEmpty: $<HTMLElement>('trend-empty'),
  addForm: $<HTMLFormElement>('add-form'),
  electricInput: $<HTMLInputElement>('electric-input'),
  waterInput: $<HTMLInputElement>('water-input'),
  exportButton: $<HTMLButtonElement>('export-button'),
  importButton: $<HTMLButtonElement>('import-button'),
  importFile: $<HTMLInputElement>('import-file'),
  clearButton: $<HTMLButtonElement>('clear-button'),
  shareRecharge: $<HTMLButtonElement>('share-recharge'),
  toast: $<HTMLDivElement>('toast'),
};

const PAY_URL = 'https://dfyc.utc.scut.edu.cn/sdms-weixin-pay/newWeixin/index.html';
const CN_TIME = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: false,
});

let localRows: Reading[] = [];
let example = false;
let range: number | 'all' = 30;
let toastDismiss: number | null = null;

function showMessage(message: string): void {
  ui.toast.textContent = message;
  ui.toast.hidden = false;
  if (toastDismiss !== null) clearTimeout(toastDismiss);
  toastDismiss = window.setTimeout(() => { ui.toast.hidden = true; }, 4200);
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : '操作未成功，请稍后重试';
}

function activeRows(): Reading[] {
  return example ? demoHistory() : localRows;
}

function trendHistory(points: Reading[]): ElectricHistory {
  const historyPoints: ElectricHistoryPoint[] = points.map((point) => ({
    updatedAt: point.updatedAt,
    electric: point.electric,
    source: 'manual'
  }));
  return { campus: 'DXC', unit: '元', points: historyPoints };
}

function repaint(): void {
  const rows = activeRows();
  const latest = rows.length ? rows[rows.length - 1] : null;
  ui.electric.textContent = latest ? latest.electric.toFixed(2) : '—';
  ui.water.textContent = latest?.water == null ? '—' : '¥' + latest.water.toFixed(2);
  ui.updated.textContent = latest
    ? '记录于 ' + CN_TIME.format(new Date(latest.updatedAt))
    : '尚无本机记录';
  ui.demoBanner.hidden = !example;
  ui.demoButton.textContent = example ? '退出演示' : '查看演示';

  drawElectricTrend({
    svg: ui.trendSvg,
    summary: ui.trendSummary,
    selected: ui.trendSelected,
    increases: ui.trendIncreases,
    empty: ui.trendEmpty,
  }, trendHistory(rows), range);

  for (const element of document.querySelectorAll<HTMLButtonElement>('[data-trend-range]')) {
    const val = element.dataset.trendRange;
    element.setAttribute('aria-pressed', String(val === String(range)));
  }
}

async function reload(): Promise<void> {
  localRows = await readHistory();
  if (localRows.length > 1000) showMessage('本机记录超过管理上限，建议先导出备份');
  repaint();
}

function wire(): void {
  ui.demoButton.addEventListener('click', () => {
    example = !example;
    repaint();
  });
  document.querySelectorAll<HTMLButtonElement>('[data-trend-range]').forEach((button) => {
    button.addEventListener('click', () => {
      range = button.dataset.trendRange === 'all' ? 'all' : Number(button.dataset.trendRange);
      repaint();
    });
  });

  ui.addForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const electric = parseManualMoney(ui.electricInput.value);
    const water = ui.waterInput.value.trim() === '' ? null : parseManualMoney(ui.waterInput.value);
    if (electric === null || (ui.waterInput.value.trim() !== '' && water === null)) {
      showMessage('请输入非负金额，最多两位小数');
      return;
    }
    const row: Reading = { updatedAt: Date.now(), electric, water, source: 'manual' };
    const saveButton = ui.addForm.querySelector<HTMLButtonElement>('[type="submit"]')!;
    saveButton.disabled = true;
    void saveReadings([row]).then(async () => {
      example = false;
      await reload();
      ui.electricInput.value = '';
      ui.waterInput.value = '';
      showMessage('已保存到此设备');
    }).catch((err: unknown) => showMessage(errorMessage(err)))
      .finally(() => { saveButton.disabled = false; });
  });

  ui.exportButton.addEventListener('click', () => {
    if (localRows.length === 0) {
      showMessage('还没有真实记录可以导出');
      return;
    }
    try {
      const body = formatBackup(localRows);
      const url = URL.createObjectURL(new Blob([body], { type: 'application/json;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'huagongmumian-local-history.json';
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      showMessage('备份文件已交给浏览器保存');
    } catch (err) { showMessage(errorMessage(err)); }
  });

  ui.importButton.addEventListener('click', () => ui.importFile.click());
  ui.importFile.addEventListener('change', () => {
    const file = ui.importFile.files?.[0];
    ui.importFile.value = '';
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      showMessage('备份文件超过 1 MB');
      return;
    }
    void (async () => {
      const points = parseBackup(await file.text());
      if (points.length === 0) {
        showMessage('备份中没有历史记录');
        return;
      }
      await saveReadings(points);
      example = false;
      await reload();
      showMessage('已导入 ' + points.length + ' 条记录（按时间合并）');
    })().catch((err: unknown) => showMessage(errorMessage(err)));
  });

  ui.clearButton.addEventListener('click', () => {
    if (!window.confirm('确认删除此设备内的全部余额历史？此操作不能撤销。请先导出备份。')) return;
    void clearHistory().then(async () => {
      example = false;
      await reload();
      showMessage('本机历史已清除');
    }).catch((err: unknown) => showMessage(errorMessage(err)));
  });

  ui.shareRecharge.addEventListener('click', () => {
    const payload = { title: '华工大学城校区官方充值', text: '华工官方充值入口', url: PAY_URL };
    void (async () => {
      if (navigator.share) {
        try {
          await navigator.share(payload);
          return;
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === 'AbortError') return;
        }
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(PAY_URL);
        showMessage('已复制官方链接，可粘贴到微信里打开');
        return;
      }
      showMessage('请使用“浏览器打开”或手动复制官方链接');
    })().catch(() => showMessage('分享未成功，可尝试浏览器打开'));
  });

  const updateNetwork = (): void => {
    ui.connection.textContent = navigator.onLine ? '仅本机记录' : '离线可用';
  };
  window.addEventListener('online', updateNetwork);
  window.addEventListener('offline', updateNetwork);
  updateNetwork();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      void navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .catch(() => { /* Unsupported modes still work online. */ });
    });
  }
}

wire();
void reload().catch((err: unknown) => {
  showMessage(errorMessage(err));
  repaint();
});

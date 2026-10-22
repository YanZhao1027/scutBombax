import '@material/web/button/filled-button.js';
import '@material/web/button/filled-tonal-button.js';
import '@material/web/button/outlined-button.js';
import '@material/web/button/text-button.js';
import { openActivityPortal, type ActivityDestination } from './activity-portal';

/**
 * Material 3 app shell. Existing GZIC/DXC controls keep their DOM IDs and the
 * Kotlin/OkHttp bridge untouched. The independent activities screen has no
 * school session access and opens only audited HTTPS origins.
 */
export function mountBetaShell(): void {
  const utility = document.getElementById('utilities-screen');
  const activity = document.getElementById('activity-screen');
  const tabs = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[data-beta-section]')
  );
  if (!utility || !activity || tabs.length !== 2) {
    throw new Error('Material 3 beta navigation is missing required elements');
  }

  const utilityScreen = utility;
  const activityScreen = activity;
  function select(section: 'utilities' | 'activity'): void {
    utilityScreen.hidden = section !== 'utilities';
    activityScreen.hidden = section !== 'activity';

    for (const tab of tabs) {
      const selected = tab.dataset.betaSection === section;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }

    const activeTitle = section === 'utilities' ? '宿舍水电' : '活动速签';
    document.title = '花工木棉 Beta · ' + activeTitle;
    document.dispatchEvent(
      new CustomEvent('bombax:sectionchange', { detail: { section } })
    );
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      const destination = tab.dataset.betaSection;
      if (destination === 'utilities' || destination === 'activity') {
        select(destination);
      }
    });
    tab.addEventListener('keydown', (e) => {
      const index = tabs.indexOf(tab);
      let destination: number | null = null;
      if (e.key === 'ArrowLeft') destination = (index - 1 + tabs.length) % tabs.length;
      if (e.key === 'ArrowRight') destination = (index + 1) % tabs.length;
      if (e.key === 'Home') destination = 0;
      if (e.key === 'End') destination = tabs.length - 1;
      if (destination !== null) {
        e.preventDefault();
        tabs[destination].focus();
        tabs[destination].click();
      }
    });
  }

  const status = document.getElementById('activity-launch-status');
  async function open(which: ActivityDestination): Promise<void> {
    if (!status) return;
    const stage = document.getElementById('activity-open-stage');
    const showcase = document.getElementById('activity-open-showcase');
    const buttons = [stage, showcase].filter(Boolean) as HTMLElement[];
    buttons.forEach((button) => button.setAttribute('disabled', ''));
    status.textContent = '正在打开活动服务…';
    status.dataset.tone = 'wait';
    try {
      await openActivityPortal(which);
      status.textContent = which === 'stage'
        ? '已打开独立 HTTPS 活动工作台。点击左上角返回花工木棉。'
        : '已打开只使用虚构数据的演示页面。';
      status.dataset.tone = 'ok';
    } catch {
      status.textContent = '打开失败。请确认网络畅通，或重新安装最新版 Beta 后重试。';
      status.dataset.tone = 'error';
    } finally {
      buttons.forEach((button) => button.removeAttribute('disabled'));
    }
  }

  document.getElementById('activity-open-stage')?.addEventListener('click', () => {
    void open('stage');
  });
  document.getElementById('activity-open-showcase')?.addEventListener('click', () => {
    void open('showcase');
  });

  select('utilities');
}

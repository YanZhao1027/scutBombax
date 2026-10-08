import type { ElectricHistory, ElectricHistoryPoint } from './types';

/** Zero dependencies: no network, no simulated data, no external scripts. */
export interface TrendNodes {
  svg: SVGSVGElement;
  summary: HTMLElement;
  selected: HTMLElement;
  increases: HTMLUListElement;
  empty: HTMLElement;
}

const D = 86400000;
const SW = 360, SH = 224, LEFT = 47, RIGHT = 12, TOP = 16, BOTTOM = 34;
const svgNs = 'http://www.w3.org/2000/svg';
const fmtDate = (n: number): string => new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai',month:'numeric',day:'numeric'}).format(new Date(n));
const fmtTime = (n: number): string => new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(n));
const amount = (n: number, unit: string): string => (unit === '元' ? '¥' : '') + n.toFixed(2) + (unit === '元' ? '' : unit ? ' ' + unit : '');

export function filterElectricHistory(history: ElectricHistory, range: number | 'all'): ElectricHistoryPoint[] {
  const rows = history.points
    .filter(p => p.electric !== null && Number.isFinite(p.electric) && Number.isFinite(p.updatedAt) && p.updatedAt > 0)
    .sort((a,b) => a.updatedAt - b.updatedAt);
  if (!rows.length || range === 'all') return rows;
  const cutoff = rows[rows.length-1].updatedAt - range * D;
  return rows.filter(p => p.updatedAt >= cutoff);
}

export function balanceIncreases(points: ElectricHistoryPoint[]): Array<{at: number; delta: number}> {
  const out: Array<{at: number;delta: number}> = [];
  for(let i=1;i<points.length;i++) {
    const prev = points[i-1].electric, curr = points[i].electric;
    if(prev !== null && curr !== null && curr > prev) out.push({at:points[i].updatedAt,delta:curr-prev});
  }
  return out;
}

function el(name: string, attrs: Record<string,string|number>, text?: string): SVGElement {
  const node = document.createElementNS(svgNs,name);
  Object.entries(attrs).forEach(([key,value])=>node.setAttribute(key,String(value)));
  if(text!==undefined)node.textContent=text;
  return node;
}

export function drawElectricTrend(nodes: TrendNodes, history: ElectricHistory, range: number|'all'): void {
  const full = filterElectricHistory(history,'all');
  const points = filterElectricHistory(history,range);
  nodes.svg.replaceChildren(); nodes.increases.replaceChildren();
  nodes.empty.hidden = full.length !== 0;
  if(!points.length) {
    nodes.summary.textContent='暂无本地电费读数';nodes.selected.textContent='';return;
  }
  nodes.summary.textContent = points.length < 4 ? '正在积累历史读数' : '本地历史 · 最近 ' + points.length + ' 条记录';
  const minT=points[0].updatedAt,maxT=points[points.length-1].updatedAt;
  const minV=Math.min(0,...points.map(p=>p.electric!));
  const maxV=Math.max(1,...points.map(p=>p.electric!));
  const ceiling=Math.ceil(maxV/5)*5||5;
  const span=Math.max(D,maxT-minT);
  const xx=(t:number)=>LEFT+(t-minT)/span*(SW-LEFT-RIGHT);
  const yy=(v:number)=>TOP+(ceiling-v)/(ceiling-minV||1)*(SH-TOP-BOTTOM);
  for(let i=0;i<5;i++){
    const v=ceiling-(ceiling-minV)*i/4,y=yy(v);
    nodes.svg.append(el('line',{x1:LEFT,x2:SW-RIGHT,y1:y,y2:y,class:'grid'}));
    nodes.svg.append(el('text',{x:LEFT-7,y:y+4,'text-anchor':'end',class:'axis-label'},v.toFixed(v%1?1:0)));
  }
  const increases = balanceIncreases(full);
  const increasedTimes = new Set(increases.map(e=>e.at));
  let path='';
  points.forEach((p,i)=>{
    const gap = i ? p.updatedAt-points[i-1].updatedAt : 0;
    path+=(i===0 || gap>1.8*D ? 'M' : 'L')+xx(p.updatedAt).toFixed(2)+','+yy(p.electric!).toFixed(2)+' ';
  });
  nodes.svg.append(el('path',{d:path,class:'line'}));
  points.forEach(p=>{if(increasedTimes.has(p.updatedAt))nodes.svg.append(el('circle',{cx:xx(p.updatedAt),cy:yy(p.electric!),r:5,class:'increase'}));});
  nodes.svg.append(el('text',{x:LEFT,y:SH-8,class:'axis-label'},fmtDate(minT)));
  nodes.svg.append(el('text',{x:SW-RIGHT,y:SH-8,'text-anchor':'end',class:'axis-label'},fmtDate(maxT)));
  const guide=el('line',{x1:0,x2:0,y1:TOP,y2:SH-BOTTOM,class:'focus-guide'});
  const circle=el('circle',{cx:0,cy:0,r:5,class:'focus'});
  nodes.svg.append(guide,circle);
  let selected=points.length-1;
  const pick=(i:number)=>{
    selected=Math.max(0,Math.min(points.length-1,i));
    const p=points[selected],x=xx(p.updatedAt);
    guide.setAttribute('x1',String(x));guide.setAttribute('x2',String(x));
    circle.setAttribute('cx',String(x));circle.setAttribute('cy',String(yy(p.electric!)));
    nodes.selected.textContent=fmtTime(p.updatedAt)+'    '+amount(p.electric!,history.unit);
  };
  nodes.svg.onpointerdown=e=>{const rect=nodes.svg.getBoundingClientRect();const x=(e.clientX-rect.left)/rect.width*SW;let i=0;for(let j=1;j<points.length;j++)if(Math.abs(xx(points[j].updatedAt)-x)<Math.abs(xx(points[i].updatedAt)-x))i=j;pick(i);if(nodes.svg.setPointerCapture)nodes.svg.setPointerCapture(e.pointerId);};
  nodes.svg.onpointermove=e=>{if(e.buttons!==0){const rect=nodes.svg.getBoundingClientRect();const x=(e.clientX-rect.left)/rect.width*SW;let i=0;for(let j=1;j<points.length;j++)if(Math.abs(xx(points[j].updatedAt)-x)<Math.abs(xx(points[i].updatedAt)-x))i=j;pick(i);}};
  nodes.svg.onkeydown=e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();pick(selected+(e.key==='ArrowLeft'?-1:1));}};
  pick(selected);
  increases.filter(p=>points.some(q=>q.updatedAt===p.at)).reverse().forEach(item=>{
    const li=document.createElement('li');
    const date=document.createElement('span');date.textContent=fmtDate(item.at);
    const delta=document.createElement('span');delta.textContent='+'+amount(item.delta,history.unit);
    li.append(date,delta);nodes.increases.append(li);
  });
  if(!nodes.increases.children.length){const li=document.createElement('li');li.textContent='暂无余额增项';nodes.increases.append(li);}
}

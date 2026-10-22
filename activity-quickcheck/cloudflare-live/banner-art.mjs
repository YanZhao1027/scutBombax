// Original static 21:9 cartoons. No external resources, fonts, scripts or remote SVGs.
export const BANNER_WIDTH=1050,BANNER_HEIGHT=450,MAX_BANNER_BYTES=100_000;
export const PRESETS=Object.freeze([
  {key:'concert',label:'音乐与招新',hint:'音符、麦克风、舞台'},
  {key:'sports',label:'运动与比赛',hint:'跑道、球类、动感'},
  {key:'volunteer',label:'志愿与服务',hint:'绿叶、爱心、伙伴'},
  {key:'lecture',label:'讲座与分享',hint:'书本、灯泡、知识'},
  {key:'celebration',label:'节日与游园',hint:'花朵、气球、彩旗'}
]);
export function bannerKind(kind,title=''){
  if(PRESETS.some(x=>x.key===kind))return kind;
  if(/音乐|歌|招新|音乐会|合唱|舞|演出|乐队/.test(title))return 'concert';
  if(/运动|体育|球|跑步|比赛|篮球|羽毛/.test(title))return 'sports';
  if(/志愿|公益|服务|环保|植树|关怀/.test(title))return 'volunteer';
  if(/讲座|学术|分享|读书|培训|工作坊/.test(title))return 'lecture';
  return 'celebration';
}
const palette={
  concert:['#e9ddfc','#bca8fc','#533b9d','#ffb55d'],
  sports:['#cdf5ed','#65dfbb','#126c68','#fbab63'],
  volunteer:['#dcf3e0','#87dba6','#35704c','#ffb486'],
  lecture:['#dbeafd','#90bafa','#24589e','#f7ca73'],
  celebration:['#fee8ef','#f6a8cb','#9b4275','#fbc86e']
};
function ellipse(x,y,rx,ry,color,other=''){return `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${color}" ${other}/>`;}
function circle(x,y,r,color){return `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`;}
function path(d,fill,more=''){return `<path d="${d}" fill="${fill}" ${more}/>`;}
export function builtInBanner(kind){
  const key=bannerKind(kind),[background,soft,ink,accent]=palette[key];
  let scene='';
  if(key==='concert'){
    scene=`${path('M450 320 Q590 180 765 310 L750 405 L430 405Z',soft)}
      ${circle(610,163,64,accent)}${circle(610,163,43,ink)}
      <rect x="589" y="214" width="42" height="100" rx="18" fill="${ink}"/>
      ${path('M548 253 Q610 328 674 250','none',`stroke="#fff" stroke-width="15" stroke-linecap="round"`)}
      ${path('M610 310 L610 356 M555 361 L667 361','none',`stroke="${ink}" stroke-width="15" stroke-linecap="round"`)}
      ${path('M820 105 V200 Q795 183 779 197 Q749 236 786 251 Q838 269 838 216 V129 L917 113 V167 Q888 149 874 174 Q853 211 889 224 Q939 244 939 188 V76Z',ink)}
      ${path('M425 129 V207 Q391 192 376 213 Q354 250 392 264 Q449 281 448 227 V157 L518 143 V193 Q486 181 470 203 Q449 240 484 253 Q537 269 537 215 V110Z',accent)}`;
  }else if(key==='sports'){
    scene=`${path('M400 382 Q520 160 986 280 L986 400 H400Z',soft)}
      ${circle(670,217,100,'#fff')}
      ${path('M670 117 L720 155 L704 218 L643 255 L593 213 L609 152Z',ink)}
      ${path('M670 117 L647 82 M720 155 L765 142 M704 218 L748 247 M643 255 L631 300 M593 213 L545 223','none',`stroke="${ink}" stroke-width="11" stroke-linecap="round"`)}
      ${path('M475 319 Q550 276 640 315 Q727 348 820 306','none',`stroke="${accent}" stroke-width="21" stroke-linecap="round"`)}
      ${circle(433,166,30,accent)}${path('M424 200 L370 267 L466 280 L507 362','none',`stroke="${ink}" stroke-width="19" stroke-linecap="round"`)}
      ${path('M385 255 L309 313 M447 278 L391 354','none',`stroke="${ink}" stroke-width="14" stroke-linecap="round"`)}`;
  }else if(key==='volunteer'){
    scene=`${path('M440 382 Q600 230 835 375 L835 408 L440 408Z',soft)}
      ${path('M663 182 C600 115 493 182 532 272 C561 337 659 376 663 376 C668 376 769 321 799 263 C834 181 736 112 663 182Z',accent)}
      ${path('M660 373 Q641 270 685 214','none',`stroke="${ink}" stroke-width="18" stroke-linecap="round"`)}
      ${path('M641 283 Q560 193 485 260 Q540 351 641 313Z',soft)}
      ${path('M674 274 Q750 179 843 251 Q784 344 677 319Z',soft)}
      ${path('M440 355 Q550 319 602 369 Q669 415 749 367','none',`stroke="${ink}" stroke-width="22" stroke-linecap="round"`)}
      ${circle(823,128,34,accent)}${circle(472,145,24,accent)}`;
  }else if(key==='lecture'){
    scene=`${path('M511 193 Q598 137 658 205 V360 Q591 315 511 364Z','#fff',`stroke="${ink}" stroke-width="10"`)}
      ${path('M658 205 Q740 137 811 193 V364 Q721 315 658 360Z','#fff',`stroke="${ink}" stroke-width="10"`)}
      ${path('M657 205 V359 M535 241 Q596 216 631 250 M692 245 Q743 216 789 245','none',`stroke="${soft}" stroke-width="12" stroke-linecap="round"`)}
      ${circle(654,117,60,accent)}${path('M622 151 L636 183 L668 183 L685 149Z',ink)}
      ${path('M623 92 Q654 62 682 92','none',`stroke="${ink}" stroke-width="12" stroke-linecap="round"`)}
      ${circle(831,119,26,ink)}${circle(486,163,17,accent)}`;
  }else{
    scene=`${circle(538,170,65,accent)}${circle(700,214,72,soft)}${circle(841,151,55,ink)}
      ${path('M538 233 Q505 278 561 361 M700 286 Q729 331 688 377 M841 210 Q808 270 851 369','none',`stroke="${ink}" stroke-width="9" stroke-linecap="round"`)}
      ${path('M433 135 L481 153 L459 201 L423 182Z','#fff')}
      ${circle(930,275,25,accent)}${circle(440,280,25,ink)}
      ${path('M521 368 Q612 322 704 360 Q823 412 932 365','none',`stroke="${accent}" stroke-width="16" stroke-linecap="round"`)}`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1050 450" preserveAspectRatio="xMidYMid slice"><rect width="1050" height="450" fill="${background}"/><circle cx="980" cy="20" r="180" fill="${soft}" opacity=".4"/><circle cx="100" cy="410" r="160" fill="#fff" opacity=".3"/>${ellipse(780,422,340,34,'#fff','opacity=".52"')}${scene}</svg>`;
}

const tags=new Set(['svg','g','rect','circle','ellipse','line','polyline','polygon','path','text','tspan']);
const shapes=new Set(['rect','circle','ellipse','line','polyline','polygon','path']);
const common=new Set(['fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','fill-rule','opacity','fill-opacity','stroke-opacity']);
const numbers=new Set(['x','y','x1','y1','x2','y2','cx','cy','r','rx','ry','width','height','stroke-width','opacity','fill-opacity','stroke-opacity','font-size']);
const color=/^(none|transparent|#[0-9a-fA-F]{3,8}|[A-Za-z]{1,20}|rgb\(\s*\d{1,3}(\s*,\s*\d{1,3}){2}\s*\))$/;
const decimal=/^[+-]?(?:\d+\.?\d*|\.\d+)$/;
const esc=(s)=>s.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function attribute(name,value,tag){
  if(value.length>20_000)throw new Error('SVG 属性过长');
  if(name==='viewBox'){if(tag!=='svg')throw new Error('非法 viewBox');return true;}
  if(name==='xmlns'){if(tag!=='svg'||value!=='http://www.w3.org/2000/svg')throw new Error('SVG 命名空间不合法');return false;}
  if(tag==='svg'&&['width','height','preserveAspectRatio'].includes(name))return false;
  if(common.has(name)){
    if(['fill','stroke'].includes(name)){if(!color.test(value))throw new Error('SVG 仅支持纯色，禁止外部引用或 CSS URL');}
    else if(name==='stroke-linecap'){if(!['butt','round','square'].includes(value))throw new Error('线条样式无效');}
    else if(name==='stroke-linejoin'){if(!['round','bevel','miter'].includes(value))throw new Error('线条样式无效');}
    else if(name==='fill-rule'){if(!['nonzero','evenodd'].includes(value))throw new Error('填充规则无效');}
    else if(!decimal.test(value)||Math.abs(Number(value))>10000)throw new Error('SVG 数值属性无效');
    return true;
  }
  if(numbers.has(name)&&tag!=='svg'){
    if(!decimal.test(value)||Math.abs(Number(value))>10000)throw new Error('SVG 数值属性无效');
    return true;
  }
  if(name==='d'&&tag==='path'){
    if(!/^[\d\s.,+\-eEMmLlHhVvCcSsQqTtAaZz]+$/.test(value))throw new Error('不支持的 SVG 路径');
    return true;
  }
  if(name==='points'&&['polygon','polyline'].includes(tag)){
    if(!/^[\d\s.,+\-]+$/.test(value))throw new Error('不支持的点坐标');
    return true;
  }
  if(name==='font-family'&&['text','tspan'].includes(tag)&&['sans-serif','monospace'].includes(value))return true;
  if(name==='font-weight'&&['text','tspan'].includes(tag)&&['bold','normal','600','700'].includes(value))return true;
  if(name==='text-anchor'&&['text','tspan'].includes(tag)&&['start','middle','end'].includes(value))return true;
  throw new Error('SVG 中存在不允许的元素属性：'+name);
}
/**
 * Restricted XML parser + allowlisted reserializer. Designed for static
 * hand-drawn SVG exports; intentionally rejects CSS, scripts, links, images,
 * external fetches, animations, filters, XML entities, DTD and foreignObject.
 * The original SVG is NEVER returned to browsers.
 */
export function sanitizeUploadedSvg(raw){
  if(typeof raw!=='string'||raw.length===0||new TextEncoder().encode(raw).byteLength>=MAX_BANNER_BYTES)
    throw new Error('SVG 必须小于 100 KB');
  if(/<!|<\?|&|[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(raw))
    throw new Error('SVG 不允许 XML 实体、脚本、DOCTYPE 或声明');
  const stack=[],result=[];let last=0,nodes=0,viewBox=null;
  const matcher=/<[^<>]+>/g;
  for(const m of raw.matchAll(matcher)){
    const between=raw.slice(last,m.index);
    if(between.trim()){
      if(!['text','tspan'].includes(stack.at(-1)))throw new Error('SVG 结构或文本非法');
      result.push(esc(between));
    }
    last=m.index+m[0].length;
    const part=m[0],close=part.startsWith('</');
    const parse=part.match(close? /^<\/([A-Za-z][A-Za-z0-9]*)\s*>$/ : /^<([A-Za-z][A-Za-z0-9]*)([\s\S]*?)\s*(\/?)>$/);
    if(!parse)throw new Error('SVG 标签格式不合法');
    const tag=parse[1];
    if(!tags.has(tag))throw new Error('SVG 标签被禁止：'+tag);
    if(close){
      if(stack.pop()!==tag)throw new Error('SVG 标签不匹配');
      result.push('</'+tag+'>');
      continue;
    }
    nodes++;if(nodes>650||stack.length>22)throw new Error('SVG 过于复杂');
    if(!stack.length&&(nodes!==1||tag!=='svg'))throw new Error('SVG 必须以根 svg 开始');
    if(stack.length&&tag==='svg')throw new Error('SVG 不支持嵌套根节点');
    if(stack.length&&!['svg','g','text','tspan'].includes(stack.at(-1)))throw new Error('SVG 标签嵌套非法');
    if(['text','tspan'].includes(stack.at(-1))&&tag!=='tspan')throw new Error('文本内不允许图形');
    let attrs=parse[2]||'',values={},safeAttrs=[];
    while(attrs.trim()){
      const match=attrs.match(/^\s+([A-Za-z][A-Za-z0-9-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/);
      if(!match)throw new Error('SVG 属性格式错误（须以引号包裹）');
      const name=match[1],value=match[2]??match[3];
      if(Object.hasOwn(values,name))throw new Error('SVG 属性重复');
      values[name]=value;
      if(attribute(name,value,tag))safeAttrs.push(name+'="'+esc(value)+'"');
      attrs=attrs.slice(match[0].length);
    }
    if(tag==='svg'){
      if(parse[3])throw new Error('SVG 根节点必须包含闭合标签');
      const parts=String(values.viewBox||'').trim().split(/[\s,]+/).map(Number);
      if(parts.length!==4||parts.some(x=>!Number.isFinite(x))||parts[2]<=0||parts[3]<=0||
        Math.abs(parts[2]/parts[3]-21/9)>0.004 ||parts.some(x=>Math.abs(x)>100000))
        throw new Error('上传 SVG 须使用 21:9 横幅 viewBox');
      viewBox=parts.join(' ');
      result.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="'+viewBox+'">');
    }else result.push('<'+tag+(safeAttrs.length?' '+safeAttrs.join(' '):'')+(parse[3]?'/':'')+'>');
    if(!parse[3])stack.push(tag);
  }
  if(raw.slice(last).trim()||stack.length||!viewBox)throw new Error('SVG 末尾或标签结构无效');
  const cleaned=result.join('');
  if(new TextEncoder().encode(cleaned).byteLength>=MAX_BANNER_BYTES)
    throw new Error('SVG 清理后超过 100 KB');
  return cleaned;
}

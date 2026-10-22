import {SaxesParser} from 'saxes';

// Accept a deliberately restricted, *illustration-only* subset of SVG.
// The submitted source is NEVER served verbatim. Reconstruct canonical XML
// from a whitelist. No JS, CSS, text, href, foreignObject, images, animation,
// external resources, DTD, entities, or on* attributes.
export const MAX_BANNER_BYTES=100_000; // "less than 100 KB", not 100 KiB
export const BANNER_PRESETS=Object.freeze(['music','volunteer','sports','science','festival']);
export function isPreset(s){return BANNER_PRESETS.includes(s);}
export function suggestPreset(title=''){
  const t=String(title);
  if(/音乐|演唱|乐队|歌|concert|music/i.test(t))return 'music';
  if(/志愿|公益|环保|义工/.test(t))return 'volunteer';
  if(/运动|比赛|篮球|足球|跑步|体育/.test(t))return 'sports';
  if(/科技|实验|编程|学术|科创|AI/.test(t))return 'science';
  return 'festival';
}
const tags={
  svg:['xmlns','viewBox','width','height','preserveAspectRatio'],
  g:['fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','opacity','transform'],
  path:['d','fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','opacity','transform'],
  rect:['x','y','width','height','rx','ry','fill','stroke','stroke-width','opacity','transform'],
  circle:['cx','cy','r','fill','stroke','stroke-width','opacity','transform'],
  ellipse:['cx','cy','rx','ry','fill','stroke','stroke-width','opacity','transform'],
  line:['x1','y1','x2','y2','stroke','stroke-width','stroke-linecap','opacity','transform'],
  polygon:['points','fill','stroke','stroke-width','opacity','transform'],
  polyline:['points','fill','stroke','stroke-width','stroke-linecap','opacity','transform'],
  defs:[],
  linearGradient:['id','x1','y1','x2','y2','gradientUnits'],
  radialGradient:['id','cx','cy','r','fx','fy','gradientUnits'],
  stop:['offset','stop-color','stop-opacity']
};
const number='[-+]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:[Ee][-+]?\\d+)?';
const nre=new RegExp('^'+number+'%?$');
const nums=new RegExp('^\\s*'+number+'(?:[\\s,]+'+number+')+\\s*$');
const paint=/^(?:#[0-9A-Fa-f]{3,8}|none|transparent|url\(#[a-zA-Z][\w-]{0,40}\))$/;
const transform=/^(?:(?:translate|scale|rotate|matrix|skewX|skewY)\([\d\s.,+\-Ee]+\)\s*){1,5}$/;
const dpath=/^[\s0-9.,+\-EeMmLlHhVvCcSsQqTtAaZz]{1,14000}$/;
const entity=/&|<\s*!|<\s*\?/;
function attrOkay(tag,key,val){
  if(key==='xmlns')return tag==='svg'&&val==='http://www.w3.org/2000/svg';
  if(key==='preserveAspectRatio')return tag==='svg'&&['xMidYMid meet','xMidYMid slice'].includes(val);
  if(key==='viewBox'){
    const xs=val.trim().split(/[\s,]+/).map(Number);
    return tag==='svg'&&xs.length===4&&xs.every(Number.isFinite)&&xs[2]>0&&xs[3]>0
      &&Math.abs(xs[2]/xs[3]-21/9)<0.012&&xs.every(v=>Math.abs(v)<100000);
  }
  if(key==='d')return dpath.test(val);
  if(key==='points')return val.length<12000&&nums.test(val);
  if(key==='transform')return val.length<300&&transform.test(val);
  if(key==='id')return /^[a-zA-Z][\w-]{0,40}$/.test(val);
  if(['fill','stroke','stop-color'].includes(key))return paint.test(val);
  if(key==='stroke-linecap')return ['butt','round','square'].includes(val);
  if(key==='stroke-linejoin')return ['round','miter','bevel'].includes(val);
  if(key==='gradientUnits')return ['userSpaceOnUse','objectBoundingBox'].includes(val);
  if(['opacity','stop-opacity'].includes(key))return nre.test(val)&&Number(val)>=0&&Number(val)<=1;
  if(key==='offset')return nre.test(val)&&Number(val.replace('%',''))>=0&&Number(val.replace('%',''))<=100;
  return nre.test(val)&&Math.abs(Number(val.replace('%','')))<100000;
}
function attrEscape(v){return String(v).replaceAll('&','&amp;').replaceAll('"','&quot;');}
export function sanitizeBannerSvg(content){
  if(typeof content!=='string')throw new Error('无效 SVG 文本');
  const bytes=new TextEncoder().encode(content);
  if(bytes.length===0||bytes.length>=MAX_BANNER_BYTES)throw new Error('SVG 必须小于 100 KB');
  if(entity.test(content)||/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(content))
    throw new Error('SVG 禁止 XML 指令、实体、注释和不可见字符');
  let nodes=0,depth=0,rootFound=false,closed=false,serialized='';
  const parser=new SaxesParser({xmlns:false,fragment:false});
  parser.on('opentag',node=>{
    const tag=node.name;
    if(!Object.hasOwn(tags,tag))throw new Error('SVG 包含不支持的元素：'+tag);
    if(closed||(!rootFound&&tag!=='svg')||(rootFound&&tag==='svg'))
      throw new Error('SVG 根节点格式不正确');
    if(++nodes>1000||++depth>24)throw new Error('SVG 画面过于复杂');
    if(tag==='svg')rootFound=true;
    if(Object.keys(node.attributes).length>35)throw new Error('SVG 属性过多');
    const attrs=Object.entries(node.attributes);
    const mapping={};
    for(const [key,val] of attrs){
      if(!tags[tag].includes(key)||!attrOkay(tag,key,val))
        throw new Error('SVG 存在不安全的属性：'+key);
      mapping[key]=val;
    }
    if(tag==='svg'&&!Object.hasOwn(mapping,'viewBox'))throw new Error('SVG 需要 21:9 的 viewBox');
    if(tag==='svg'&&mapping.xmlns&&mapping.xmlns!=='http://www.w3.org/2000/svg')
      throw new Error('SVG 命名空间不正确');
    if(tag==='svg'){
      // Force physical output at exactly 21:9; keep only the validated viewBox.
      serialized+='<svg xmlns="http://www.w3.org/2000/svg" width="2100" height="900" viewBox="'+attrEscape(mapping.viewBox)+'">';
    }else{
      serialized+='<'+tag;
      for(const [key,val] of attrs)serialized+=' '+key+'="'+attrEscape(val)+'"';
      serialized+='>';
    }
  });
  parser.on('closetag',node=>{
    serialized+='</'+(typeof node==='string'?node:node.name)+'>';
    if(--depth===0)closed=true;
  });
  parser.on('text',t=>{if(t.trim())throw new Error('活动插画不允许嵌入文字或脚本');});
  parser.on('cdata',()=>{throw new Error('SVG 不允许 CDATA');});
  parser.on('doctype',()=>{throw new Error('SVG 不允许 DOCTYPE');});
  parser.on('comment',()=>{throw new Error('SVG 不允许注释');});
  parser.on('processinginstruction',()=>{throw new Error('SVG 不允许 XML 指令');});
  try{parser.write(content).close();}catch(e){throw new Error('不符合安全 SVG 规范：'+(e.message||'解析失败').slice(0,90));}
  if(!rootFound||!closed||depth!==0)throw new Error('SVG 必须有完整闭合的根节点');
  if(new TextEncoder().encode(serialized).byteLength>=MAX_BANNER_BYTES)throw new Error('SVG 输出超过 100 KB');
  return serialized;
}

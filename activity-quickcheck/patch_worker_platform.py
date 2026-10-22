from pathlib import Path
p=Path('cloudflare-live/worker.mjs')
s=p.read_text()
def one(a,b):
 global s
 n=s.count(a)
 if n!=1:raise Exception(f'expected 1 match, got {n} for {a[:130]!r}')
 s=s.replace(a,b)
one("import QRCode from 'qrcode';","import QRCode from 'qrcode';\nimport {PRESETS,bannerKind,builtInBanner,sanitizeUploadedSvg,MAX_BANNER_BYTES} from './banner-art.mjs';")
one("const GUEST_AFTER_EVENT_MS=30*86400_000;","""const GUEST_AFTER_EVENT_MS=30*86400_000;
const bannerKey=eid=>'event-banners/'+eid+'.svg';
const svgResponse=svg=>new Response(svg,{headers:{
  'Content-Type':'image/svg+xml; charset=utf-8','Cache-Control':'public, max-age=0, must-revalidate',
  'Content-Security-Policy':"default-src 'none'; sandbox",'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin'
}});""")
one("  const user=await current(db,req);\n  if(method==='GET'&&p==='/api/me')",
"""  const user=await current(db,req);
  if(method==='GET'&&p==='/api/banner-presets')return json({presets:PRESETS});
  const catalog=p.match(/^\\/api\\/banner-presets\\/([a-z]+)$/);
  if(method==='GET'&&catalog){
    need(PRESETS.some(x=>x.key===catalog[1]),404,'内置插画不存在');
    return svgResponse(builtInBanner(catalog[1]));
  }
  if(method==='GET'&&p==='/api/me')""")
one("""    const rows=await db.prepare('SELECT id,title,guidelines,lat,lon,radius_m,starts_at,ends_at,require_photo FROM activity_events ORDER BY starts_at DESC LIMIT 100').all();""",
"""    const rows=await db.prepare('SELECT id,title,guidelines,lat,lon,radius_m,starts_at,ends_at,require_photo,COALESCE(join_starts_at,created_at) AS join_starts_at,COALESCE(join_ends_at,ends_at) AS join_ends_at FROM activity_events ORDER BY starts_at DESC LIMIT 100').all();""")
one("""    need(ends>epoch(),400,'活动结束时间已过去；请设置为将来的时间，并检查设备时钟及所在时区');
    const id=uuid();
    await db.prepare('INSERT INTO activity_events(id,owner_id,title,guidelines,lat,lon,radius_m,starts_at,ends_at,require_photo,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id,user.id,str(x.title,100),String(x.guidelines||'').slice(0,1000),lat,lon,radius,starts,ends,x.requirePhoto===false?0:1,epoch()).run();
    return json({id},201);""",
"""    need(ends>epoch(),400,'活动结束时间已过去；请设置为将来的时间，并检查设备时钟及所在时区');
    const now=epoch();
    const joinStarts=x.joinStartsAt===undefined?now:x.joinStartsAt;
    const joinEnds=x.joinEndsAt===undefined?ends:x.joinEndsAt;
    need([joinStarts,joinEnds].every(Number.isFinite)&&joinStarts<joinEnds&&joinEnds>now&&joinEnds<=ends,
      400,'报名时间不合法：开始须早于截止，报名截止不可晚于活动结束');
    const title=str(x.title,100),kind=bannerKind(x.bannerPreset,title);
    need(x.bannerPreset===undefined||PRESETS.some(p=>p.key===x.bannerPreset),400,'内置插画主题不存在');
    const id=uuid();
    await db.prepare('INSERT INTO activity_events(id,owner_id,title,guidelines,lat,lon,radius_m,starts_at,ends_at,require_photo,created_at,join_starts_at,join_ends_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id,user.id,title,String(x.guidelines||'').slice(0,1000),lat,lon,radius,starts,ends,x.requirePhoto===false?0:1,now,joinStarts,joinEnds).run();
    // Store the selected builtin art in the private Stage R2 prefix. If this
    // fails, GET /banner falls back to a safe matching builtin illustration.
    await env.MATERIALS.put(bannerKey(id),utf8(builtInBanner(kind)));
    return json({id,bannerPreset:kind},201);""")
one("""    need(event,404,'活动不存在');
    if(method==='GET'&&action===''){""",
"""    need(event,404,'活动不存在');
    if(method==='GET'&&action==='banner'){
      const object=await env.MATERIALS.get(bannerKey(eid));
      if(object)return svgResponse(await object.arrayBuffer());
      return svgResponse(builtInBanner(bannerKind(null,event.title)));
    }
    if(method==='POST'&&action==='banner'){
      await access(db,user,eid,['owner']);
      need(/^image\\/svg\\+xml(?:\\s*;\\s*charset=utf-8)?$/i.test(req.headers.get('Content-Type')||''),
        415,'仅接受 SVG 原文件');
      const raw=await readBounded(req,MAX_BANNER_BYTES);
      need(raw.byteLength>0&&raw.byteLength<MAX_BANNER_BYTES,413,'插画必须小于 100 KB');
      let source;
      try{source=new TextDecoder('utf-8',{fatal:true}).decode(raw);}catch{err(400,'SVG UTF-8 编码无效');}
      let cleaned;
      try{cleaned=sanitizeUploadedSvg(source);}catch(error){err(400,error.message);}
      await env.MATERIALS.put(bannerKey(eid),utf8(cleaned));
      await audit(db,eid,user.id,'event.banner.upload',eid);
      return json({ok:true,bytes:utf8(cleaned).byteLength},200);
    }
    if(method==='POST'&&action==='banner-preset'){
      await access(db,user,eid,['owner']);
      const x=await body(req);
      need(PRESETS.some(b=>b.key===x.preset),400,'内置插画主题无效');
      await env.MATERIALS.put(bannerKey(eid),utf8(builtInBanner(x.preset)));
      await audit(db,eid,user.id,'event.banner.preset',eid);
      return json({ok:true,preset:x.preset});
    }
    if(method==='GET'&&action===''){""")
one("""      need(epoch()<=event.ends_at,409,'报名结束');""",
"""      need(epoch()>=(event.join_starts_at??event.created_at),409,'报名还未开始');
      need(epoch()<=(event.join_ends_at??event.ends_at),409,'报名已经截止');""")
needle="""    if(method==='POST'&&action==='redeem'){"""
batch="""    if(method==='POST'&&action==='review-batch'){
      await access(db,user,eid,['owner','reviewer']);
      const x=await body(req,32768);
      need(Array.isArray(x.decisions)&&x.decisions.length>0&&x.decisions.length<=80,
        400,'每次可提交 1 至 80 条审核决定');
      const ids=new Set(),list=x.decisions.map(d=>{
        need(d&&typeof d==='object',400,'审核决定格式错误');
        const id=str(d.registrationId,40),state=d.state;
        need(/^[a-f0-9-]{36}$/.test(id)&&!ids.has(id),400,'审核编号无效或重复');
        need(['approved','rejected'].includes(state),400,'仅支持通过或驳回');
        ids.add(id);
        const reason=String(d.reason||'').trim().slice(0,300);
        return {id,state,reason:state==='rejected'&&!reason?'请按活动要求补充材料':reason};
      });
      const items=await db.prepare(
        'SELECT r.id,r.state,t.channel,(SELECT COUNT(*) FROM activity_files f WHERE f.registration_id=r.id) materials FROM activity_registrations r LEFT JOIN activity_attendance t ON t.registration_id=r.id WHERE r.event_id=? AND r.id IN ('+
        list.map(()=>'?').join(',')+')').bind(eid,...list.map(x=>x.id)).all();
      need(items.results.length===list.length,409,'报名清单已变化，请刷新');
      for(const row of items.results){
        const decision=list.find(x=>x.id===row.id);
        need(row.state==='pending'&&row.channel!=='scan',409,'有报名已审核或签到，请刷新');
        need(decision.state!=='approved'||!event.require_photo||row.materials>0,
          409,'存在未上传材料的报名，不能批量通过');
      }
      const now=epoch(),statements=[];
      for(const decision of list){
        statements.push(db.prepare(
          "UPDATE activity_registrations SET state=?,review_reason=?,reviewed_by=?,reviewed_at=?,updated_at=? WHERE id=? AND event_id=? AND state='pending' AND NOT EXISTS (SELECT 1 FROM activity_attendance t WHERE t.registration_id=? AND t.channel='scan')"
        ).bind(decision.state,decision.reason,user.id,now,now,decision.id,eid,decision.id));
        statements.push(db.prepare(
          "INSERT INTO activity_audit(id,event_id,actor_id,action,subject_id,occurred_at) SELECT ?,?,?,?, ?,? WHERE EXISTS (SELECT 1 FROM activity_registrations WHERE id=? AND event_id=? AND state=? AND reviewed_by=? AND reviewed_at=?)"
        ).bind(uuid(),eid,user.id,'registration.review.'+decision.state,decision.id,now,decision.id,eid,decision.state,user.id,now));
      }
      const changes=await db.batch(statements);
      // D1 batch is transactional. On a concurrent review race, report exactly
      // what committed and require a refresh instead of claiming all passed.
      const updated=list.reduce((n,_,i)=>n+(changes[2*i]?.meta?.changes??changes[2*i]?.changes??0),0);
      need(updated===list.length,409,'审核队列并发变化，已处理部分记录；请刷新核对');
      return json({ok:true,reviewed:updated});
    }
"""
if s.count(needle)!=1:raise Exception('Review batch endpoint anchor absent')
s=s.replace(needle,batch+needle)
p.write_text(s)
migration=Path('cloudflare-live/migrations/0004_join_window.sql')
migration.write_text("""-- Separate activity time from the public registration window (additive, nullable).
-- Existing activities continue to accept signup from creation until event end.
ALTER TABLE activity_events ADD COLUMN join_starts_at INTEGER;
ALTER TABLE activity_events ADD COLUMN join_ends_at INTEGER;
""")
print('Worker: separate join window, SVG art, safe upload and audited batch review implemented')

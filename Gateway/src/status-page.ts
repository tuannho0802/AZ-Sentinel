/**
 * Giao diện cục bộ của Gateway (Plan 3C mục 7). Một file HTML tĩnh, tự gọi `/v1/status` mỗi 2 giây.
 * Không có API key hay token trong dữ liệu trạng thái. Chỉ dùng textContent (không innerHTML), để tên
 * broker hay tên tài khoản có ký tự lạ cũng không chạy được mã.
 *
 * Trong chuỗi JS bên dưới KHÔNG dùng template literal (backtick) và `${}` vì nằm trong template TS.
 */
export function statusPage(): string {
  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AZ Gateway</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%232563eb'/%3E%3Cpath d='M9 22V10l7 6 7-6v12' stroke='white' stroke-width='3' fill='none' stroke-linejoin='round'/%3E%3C/svg%3E">
<style>
:root{color-scheme:light dark;--bg:#f4f6fa;--card:#fff;--fg:#14171f;--mut:#667085;--line:#e4e7ee;--pri:#2563eb;--ok:#0a7d33;--okbg:#e3f6ea;--bad:#b3261e;--badbg:#fde8e6;--warn:#8a5a00;--warnbg:#fff3d6}
@media (prefers-color-scheme:dark){:root{--bg:#0f1117;--card:#181b24;--fg:#e8eaf0;--mut:#9097a6;--line:#272b38;--pri:#6c9bff;--ok:#4cc27a;--okbg:#12301f;--bad:#ff6b61;--badbg:#3a1815;--warn:#f1bf55;--warnbg:#3a2d10}}
*{box-sizing:border-box}
body{margin:0;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--fg)}
header{display:flex;align-items:center;gap:12px;padding:16px 24px;background:var(--card);border-bottom:1px solid var(--line);flex-wrap:wrap}
.logo{width:34px;height:34px;border-radius:8px;background:var(--pri);display:grid;place-items:center}
h1{font-size:17px;margin:0;line-height:1.2}.sub{color:var(--mut);font-size:12px}
.sp{flex:1}
main{max-width:1100px;margin:0 auto;padding:20px 24px 48px}
.banner{display:none;margin-bottom:16px;padding:10px 14px;border-radius:10px;background:var(--warnbg);color:var(--warn);font-weight:500}
.banner a{color:inherit}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.card .k{color:var(--mut);font-size:12px;text-transform:uppercase;letter-spacing:.04em}
.card .v{font-size:20px;font-weight:600;margin-top:2px;display:flex;align-items:center;gap:8px}
.dot{width:10px;height:10px;border-radius:50%;background:var(--mut);flex:none}
.dot.ok{background:var(--ok)}.dot.bad{background:var(--bad)}
section{background:var(--card);border:1px solid var(--line);border-radius:12px;margin-bottom:20px;overflow:hidden}
section>h2{font-size:14px;margin:0;padding:12px 16px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:8px}
.wrap{overflow-x:auto}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:9px 16px;border-bottom:1px solid var(--line);white-space:nowrap}
th{color:var(--mut);font-weight:500;font-size:12px}tr:last-child td{border-bottom:0}
.pill{display:inline-block;padding:1px 9px;border-radius:99px;font-size:12px;font-weight:500;background:var(--line);color:var(--mut)}
.pill.ok{background:var(--okbg);color:var(--ok)}.pill.bad{background:var(--badbg);color:var(--bad)}
.empty{padding:18px 16px;color:var(--mut)}
.empty ol{margin:8px 0 0;padding-left:20px}.empty li{margin:2px 0}
code,pre{font:12px/1.5 ui-monospace,Consolas,monospace}
code{background:var(--bg);padding:1px 5px;border-radius:4px;border:1px solid var(--line)}
form{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;padding:16px}
label{display:block;font-size:12px;color:var(--mut);margin-bottom:3px}
input{width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg);font:inherit}
input:focus{outline:2px solid var(--pri);outline-offset:-1px}
.hint{font-size:12px;color:var(--mut);margin-top:3px}
.act{grid-column:1/-1;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg);cursor:pointer}
button.pri{background:var(--pri);border-color:var(--pri);color:#fff}
button:disabled{opacity:.5;cursor:default}
#msg{font-size:13px}.ok-t{color:var(--ok)}.bad-t{color:var(--bad)}
pre{margin:0;padding:12px 16px;max-height:280px;overflow:auto;background:var(--bg);white-space:pre-wrap;word-break:break-all}
details>summary{cursor:pointer;padding:12px 16px;font-weight:600;list-style:none}
details>summary::before{content:"\\25B8  ";color:var(--mut)}details[open]>summary::before{content:"\\25BE  "}
</style></head><body>
<header>
  <div class="logo"><svg width="20" height="20" viewBox="0 0 32 32"><path d="M9 22V10l7 6 7-6v12" stroke="#fff" stroke-width="3" fill="none" stroke-linejoin="round"/></svg></div>
  <div><h1>AZ Gateway <span id="ver" class="sub"></span></h1><div class="sub" id="host"></div></div>
  <div class="sp"></div>
  <button id="copy" type="button">Sao chép chẩn đoán</button>
</header>
<main>
  <div class="banner" id="upd"></div>
  <div class="cards">
    <div class="card"><div class="k">Cloud</div><div class="v"><span class="dot" id="cdot"></span><span id="ctext">-</span></div></div>
    <div class="card"><div class="k">Terminal online</div><div class="v" id="tonl">-</div></div>
    <div class="card"><div class="k">Đang được xem</div><div class="v" id="twat">-</div></div>
    <div class="card"><div class="k">Hàng đợi sự kiện</div><div class="v" id="tque">-</div></div>
    <div class="card"><div class="k">Thời gian chạy</div><div class="v" id="tup">-</div></div>
  </div>

  <section>
    <h2>Terminal MT5</h2>
    <div class="wrap"><table><thead><tr><th>Tài khoản</th><th>Server</th><th>EA</th><th>Trạng thái</th><th>Ghép nối</th><th>Xem live</th><th>Thấy lần cuối</th><th>Hàng đợi</th></tr></thead><tbody id="rows"></tbody></table></div>
    <div class="empty" id="empty" hidden>
      Chưa có terminal nào báo về. Làm một lần cho mỗi terminal MT5:
      <ol>
        <li>Mở MT5, vào <b>Tools &gt; Options &gt; Expert Advisors</b>, bật <b>Allow WebRequest for listed URL</b> và thêm <code>http://127.0.0.1:47800</code>.</li>
        <li>Kéo EA <b>AZ_Sentinel</b> (mục Navigator &gt; Expert Advisors &gt; AZ) vào một chart bất kỳ.</li>
        <li>Bật nút <b>Algo Trading</b> trên thanh công cụ. Terminal sẽ xuất hiện ở đây sau vài giây.</li>
      </ol>
    </div>
  </section>

  <section>
    <h2>Cài đặt</h2>
    <form id="cfg" autocomplete="off">
      <div><label for="f-vps">Tên VPS (hiện trên web)</label><input id="f-vps" maxlength="64" required></div>
      <div><label for="f-url">Cloud URL</label><input id="f-url" placeholder="wss://ten.workers.dev/api/gw/ws"><div class="hint">Để trống = chỉ chạy cục bộ, không có live.</div></div>
      <div><label for="f-tok">Token kết nối</label><input id="f-tok" type="password" placeholder="" autocomplete="new-password"><div class="hint" id="tokhint"></div></div>
      <div><label for="f-idle">Giữ sự kiện khi không ai xem (giây)</label><input id="f-idle" type="number" min="0" max="86400"><div class="hint">0 = gửi ngay.</div></div>
      <div class="act"><button class="pri" id="save" type="submit">Lưu và khởi động lại</button><span id="msg"></span></div>
    </form>
  </section>

  <section><details id="logbox"><summary>Nhật ký (log)</summary><pre id="log">Đang tải...</pre></details></section>
</main>
<script>
const $=id=>document.getElementById(id);
let last=null,cfg=null,dirty=false;
function pill(td,text,cls){const s=document.createElement('span');s.className='pill'+(cls?' '+cls:'');s.textContent=text;td.appendChild(s)}
function cell(tr,text,cls){const td=document.createElement('td');if(cls==null)td.textContent=text;else pill(td,text,cls);tr.appendChild(td)}
function dur(s){const d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);return d?d+'n '+h+'g':h?h+'g '+m+'p':m?m+'p':s+'s'}
async function tick(){
  try{
    const s=await (await fetch('/v1/status',{cache:'no-store'})).json();last=s;
    $('ver').textContent='v'+s.version;$('host').textContent=s.vps||'';
    const c=s.cloud;
    $('ctext').textContent=!c.configured?'Chưa cấu hình':c.connected?'Đã kết nối':'Mất kết nối';
    $('cdot').className='dot'+(c.connected?' ok':(c.configured?' bad':''));
    const on=s.terminals.filter(t=>t.online).length;
    $('tonl').textContent=on+' / '+s.terminals.length;
    $('twat').textContent=s.watched+(s.fast?' ('+s.fast+' theo tick)':'');
    $('tque').textContent=s.queued;$('tup').textContent=dur(s.uptimeSec);
    const rows=$('rows');rows.replaceChildren();
    $('empty').hidden=s.terminals.length>0;
    for(const t of s.terminals){
      const tr=document.createElement('tr');
      cell(tr,String(t.login)+' ('+t.mode+')');
      cell(tr,t.server);
      cell(tr,t.eaVer||'-',t.online?'ok':'bad');
      cell(tr,t.online?(t.conn?'Online':'Mất broker'):'Offline',t.online&&t.conn?'ok':'bad');
      cell(tr,t.bind==='ok'?'OK':t.bind==='rejected'?'Từ chối '+t.code:'Chờ',t.bind==='ok'?'ok':(t.bind==='rejected'?'bad':''));
      cell(tr,t.watching?'Có':'Không',t.watching?'ok':'');
      cell(tr,t.lastSeenSec+'s');cell(tr,String(t.queued));
      rows.appendChild(tr);
    }
  }catch{$('ctext').textContent='Không đọc được Gateway';$('cdot').className='dot bad'}
}
async function loadCfg(){
  try{
    cfg=await (await fetch('/v1/ui/config',{cache:'no-store'})).json();
    if(dirty)return;
    $('f-vps').value=cfg.vps;$('f-url').value=cfg.cloudUrl;$('f-idle').value=cfg.idleFlushSec;
    $('tokhint').textContent=cfg.tokenSet?'Đã lưu một token. Để trống để giữ nguyên.':'Chưa có token.';
  }catch{}
}
async function loadLog(){
  if(!$('logbox').open)return;
  try{const t=await (await fetch('/v1/ui/log',{cache:'no-store'})).text();const p=$('log');const stick=p.scrollTop+p.clientHeight>=p.scrollHeight-30;p.textContent=t||'(trống)';if(stick)p.scrollTop=p.scrollHeight}catch{}
}
async function loadUpd(){
  try{
    const u=await (await fetch('/v1/ui/update',{cache:'no-store'})).json();
    const b=$('upd');
    if(u.available){b.textContent='Có bản mới v'+u.latest+'. ';const a=document.createElement('a');a.href=u.url;a.target='_blank';a.rel='noopener';a.textContent='Tải bộ cài mới';b.appendChild(a);b.style.display='block'}
  }catch{}
}
for(const id of ['f-vps','f-url','f-tok','f-idle'])$(id).addEventListener('input',()=>{dirty=true});
$('cfg').addEventListener('submit',async e=>{
  e.preventDefault();const m=$('msg');m.className='';m.textContent='Đang lưu...';$('save').disabled=true;
  try{
    const r=await fetch('/v1/ui/config',{method:'POST',headers:{'content-type':'application/json','x-az-ui':'1'},
      body:JSON.stringify({vps:$('f-vps').value,cloudUrl:$('f-url').value,cloudToken:$('f-tok').value,idleFlushSec:Number($('f-idle').value)})});
    const j=await r.json();
    if(!r.ok){m.className='bad-t';m.textContent='Lỗi: '+(j.error||r.status);$('save').disabled=false;return}
    m.className='ok-t';m.textContent='Đã lưu. Gateway đang khởi động lại...';
    await fetch('/v1/ui/restart',{method:'POST',headers:{'x-az-ui':'1'}});
    dirty=false;$('f-tok').value='';
    setTimeout(()=>location.reload(),4000);
  }catch{m.className='bad-t';m.textContent='Không lưu được';$('save').disabled=false}
});
$('copy').addEventListener('click',async()=>{
  let log='';try{log=await (await fetch('/v1/ui/log')).text()}catch{}
  const txt=JSON.stringify({status:last,config:cfg},null,2)+'\\n\\n--- log ---\\n'+log.split('\\n').slice(-60).join('\\n');
  const b=$('copy');
  try{await navigator.clipboard.writeText(txt);b.textContent='Đã sao chép'}catch{
    const ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);ta.select();try{document.execCommand('copy');b.textContent='Đã sao chép'}catch{b.textContent='Không sao chép được'}ta.remove();
  }
  setTimeout(()=>{b.textContent='Sao chép chẩn đoán'},2000);
});
tick();loadCfg();loadUpd();loadLog();
setInterval(tick,2000);setInterval(loadLog,3000);setInterval(loadCfg,15000);setInterval(loadUpd,3600000);
</script></body></html>`
}

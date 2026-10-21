/**
 * Trang trạng thái cục bộ (Plan 3C mục 7). Một file HTML tĩnh, tự gọi `/v1/status` mỗi 2 giây.
 * Không có API key trong dữ liệu trạng thái. Dùng textContent, không innerHTML, để tên broker
 * hay tên tài khoản có ký tự lạ cũng không chạy được mã.
 */
export function statusPage(): string {
  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AZ Gateway</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1a1a1a;--mut:#666;--ok:#0a7d33;--bad:#b3261e;--line:#ddd}
@media (prefers-color-scheme:dark){:root{--bg:#161616;--fg:#eee;--mut:#9a9a9a;--ok:#4cc27a;--bad:#ff6b61;--line:#333}}
body{margin:0;padding:24px;font:14px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg)}
h1{font-size:18px;margin:0 0 4px}.mut{color:var(--mut)}.ok{color:var(--ok)}.bad{color:var(--bad)}
table{border-collapse:collapse;width:100%;margin-top:16px}th,td{text-align:left;padding:6px 10px;border-bottom:1px solid var(--line)}
.wrap{overflow-x:auto;max-width:100%}
</style></head><body>
<h1>AZ Gateway <span id="ver" class="mut"></span></h1>
<div id="cloud"></div><div id="meta" class="mut"></div>
<div class="wrap"><table><thead><tr><th>Tài khoản</th><th>Server</th><th>EA</th><th>Broker</th><th>Bind</th><th>Xem live</th><th>Thấy lần cuối</th><th>Hàng đợi</th></tr></thead><tbody id="rows"></tbody></table></div>
<p class="mut" id="empty" hidden>Chưa có terminal nào. Gắn EA vào một chart và bật Algo Trading.</p>
<script>
const $=id=>document.getElementById(id);
function cell(tr,text,cls){const td=document.createElement('td');td.textContent=text;if(cls)td.className=cls;tr.appendChild(td)}
async function tick(){
  try{
    const s=await (await fetch('/v1/status',{cache:'no-store'})).json();
    $('ver').textContent='v'+s.version;
    const c=s.cloud;
    $('cloud').textContent=!c.configured?'Cloud: chưa cấu hình (chạy cục bộ)':c.connected?'Cloud: đã kết nối':'Cloud: mất kết nối, đang thử lại';
    $('cloud').className=c.connected?'ok':(c.configured?'bad':'mut');
    $('meta').textContent='Chạy '+s.uptimeSec+'s · đang xem '+s.watched+' (theo tick '+s.fast+') · hàng đợi '+s.queued+' · push '+s.pushSec+'s';
    const rows=$('rows');rows.replaceChildren();
    $('empty').hidden=s.terminals.length>0;
    for(const t of s.terminals){
      const tr=document.createElement('tr');
      cell(tr,String(t.login)+' ('+t.mode+')');cell(tr,t.server);cell(tr,t.eaVer||'-',t.online?'ok':'bad');
      cell(tr,t.online?(t.conn?'Online':'Mất broker'):'Offline',t.online&&t.conn?'ok':'bad');
      cell(tr,t.bind==='ok'?'OK':t.bind==='rejected'?'Từ chối '+t.code:'Chờ',t.bind==='ok'?'ok':(t.bind==='rejected'?'bad':'mut'));
      cell(tr,t.watching?'Có':'Không');cell(tr,t.lastSeenSec+'s');cell(tr,String(t.queued));
      rows.appendChild(tr);
    }
  }catch{$('cloud').textContent='Không đọc được trạng thái Gateway';$('cloud').className='bad'}
}
tick();setInterval(tick,2000);
</script></body></html>`
}

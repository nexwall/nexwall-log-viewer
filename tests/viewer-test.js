// Runs the page's real script against a stub DOM. Usage: node tests/viewer-test.js
const vm = require('vm'), fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname,'..','deploy/www-ns/logs-viewer/index.html'),'utf8');
const js = html.match(/<script>([\s\S]*)<\/script>/)[1];
const els = {};
const mk = () => new Proxy(function(){}, { get:(t,k)=> k==='style'?{}: k==='dataset'?{}: k==='classList'?{toggle(){}}: k==='children'?[]: k==='value'?'': k==='checked'?true: (k in t ? t[k] : (k==='querySelectorAll' ? ()=>[] : function(){})), set:(t,k,v)=>{t[k]=v;return true}, apply:()=>undefined });
const doc = { addEventListener(){}, getElementById:id=>els[id]||(els[id]=mk()), querySelectorAll:()=>[], documentElement:{}, createElement:()=>mk() };
const store = {};
const ctx = { document:doc, window:{addEventListener(){}}, navigator:{language:'en-US'}, location:{search:'', pathname:'/logs-viewer/'}, history:{replaceState(){}},
  sessionStorage:{getItem:k=>store[k]||null,setItem:(k,v)=>store[k]=v}, URLSearchParams, fetch:()=>Promise.reject(new Error('no net')),
  setInterval(){return 1}, clearInterval(){}, setTimeout(){}, console, Blob:function(){}, URL:{createObjectURL(){},revokeObjectURL(){}} };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(js + '\n;globalThis.__x = {I18N,t,describeReason,tReason,classify,parseAuth,cleanAction,macsOf,TABS,classifyWebProt,fmtBytes,fmtDur,fwRegex,setLang:(l)=>{LANG=l}};', ctx);
const X = ctx.__x; let fail = 0;
const ok = (c, m) => { if(!c){ console.log('FAIL', m); fail++; } else console.log('ok  ', m); };

// 1. translations complete
const en = Object.keys(X.I18N.en);
for (const l of ['es','pt-BR']) { const miss = en.filter(k => !(k in X.I18N[l])); const extra = Object.keys(X.I18N[l]).filter(k => !(k in X.I18N.en)); ok(!miss.length && !extra.length, `${l} has exactly the English keys (${en.length})` + (miss.length?' missing '+miss:'') + (extra.length?' extra '+extra:'')); }
// 2. every tab has a label in every language
for (const l of ['en','es','pt-BR']) ok(X.TABS.every(t => X.I18N[l]['tab.'+t.id]), `${l}: all ${X.TABS.length} tabs labelled`);
// 3. reason text
X.setLang('en');
ok(X.describeReason('DPI block') === 'DPI: application or protocol blocked by policy', 'DPI block');
ok(/IP & Geo Blocking.*inbound.*spamhaus\.v4/.test(X.describeReason('banIP/inbound/drop/spamhaus.v4')), 'banIP prefix -> list + direction: ' + X.describeReason('banIP/inbound/drop/spamhaus.v4'));
ok(/Zone policy: zone wan rejects inbound traffic/.test(X.describeReason('reject wan in')), 'zone policy: ' + X.describeReason('reject wan in'));
ok(X.describeReason('drop wan invalid ct state') === 'Invalid connection state', 'invalid ct state');
ok(X.describeReason('Allow-HTTPS-from-WAN') === 'Firewall rule: Allow-HTTPS-from-WAN', 'rule name in prefix');
ok(X.describeReason('[ 123.456] reject lan forward').startsWith('Zone policy'), 'kernel timestamp stripped');
X.setLang('pt-BR'); ok(/Bloqueio de IP e geografia/.test(X.describeReason('banIP/outbound/reject/blocklist.v4')), 'pt-BR banIP: ' + X.describeReason('banIP/outbound/reject/blocklist.v4'));
X.setLang('es'); ok(/Política de zona/.test(X.describeReason('reject wan forward')), 'es zone policy: ' + X.describeReason('reject wan forward'));
X.setLang('en');
// 4. tracer reasons follow the language
X.setLang('pt-BR'); ok(X.tReason('DPI: application or protocol blocked by policy').startsWith('DPI:'), 'tReason DPI pt'); ok(/Regra de firewall: X/.test(X.tReason('Firewall rule: X')), 'tReason rule pt'); X.setLang('en');
// 5. classification
ok(X.classify('DPI block')==='block' && X.classify('reject wan in')==='block' && X.classify('banIP/inbound/drop/x')==='block' && X.classify('Allow-Ping')==='allow', 'classify');
// 6. logins
let a = X.parseAuth({app_name:'dropbear', _msg:"Password auth succeeded for 'root' from 192.168.0.8:50276"}); ok(a && a.ok && a.user==='root' && a.via==='SSH' && a.ip.startsWith('192.168.0.8'), 'dropbear success');
a = X.parseAuth({app_name:'dropbear', _msg:"Bad password attempt for 'root' from 1.2.3.4:5555"}); ok(a && !a.ok, 'dropbear failure');
a = X.parseAuth({app_name:'nethsecurity-api', _msg:'nethsecurity_api 2026/09/30 middleware.go:1: [INFO][AUTH] authentication success for user root from <ip>'}); ok(a && a.ok && a.via==='Web', 'API login success');
a = X.parseAuth({app_name:'nethsecurity-api', _msg:'[INFO][AUTH] authentication failed for user admin from <ip>: x'}); ok(a && !a.ok && a.user==='admin', 'API login failure');
ok(X.parseAuth({app_name:'dropbear', _msg:'Child connection from 1.2.3.4:1'}) === null, 'noise ignored');
// 7. MAC
const m = X.macsOf('IN=br-lan OUT= MAC=00:0c:29:fb:88:81:00:0c:29:fc:86:b9:08:00 SRC=1.1.1.1'); ok(m && m.src==='00:0c:29:fc:86:b9' && m.dst==='00:0c:29:fb:88:81', 'MAC src/dst');
// 8. traffic and applications tab, formatting, and the action extraction that once hid every DPI row
ok(X.TABS.some(t => t.id === 'flows' && t.kind === 'flows'), 'flows tab exists');
for (const l of ['en','es','pt-BR']) for (const k of ['empty.flows','col.application','col.volume','col.duration','col.state','badge.active','badge.ended']) ok(X.I18N[l][k], `${l}: ${k}`);
ok(X.fmtBytes(0) === '0 B' && X.fmtBytes(1536) === '1.5 KB' && X.fmtBytes(5*1024*1024*1024) === '5.0 GB', 'fmtBytes');
ok(X.fmtDur(450) === '450 ms' && X.fmtDur(75000) === '1 min 15 s' && X.fmtDur(3*3600*1000+5*60000) === '3 h 5 min', 'fmtDur');
for (const line of [' DPI block: IN=br-lan OUT= SRC=1.1.1.1 DST=2.2.2.2 PROTO=TCP', '[ 123.456] DPI block: IN=br-lan OUT= SRC=1.1.1.1 DST=2.2.2.2 PROTO=TCP', 'DPI block: IN=br-lan OUT= SRC=1.1.1.1 DST=2.2.2.2 PROTO=TCP']) {
  const re = new RegExp(X.fwRegex().replace(/\\\\/g, '\\').replace(/\(\?P</g, '(?<'));
  const m = re.exec(line);
  ok(m && /^dpi/i.test(m.groups.nf_action) && m.groups.src_ip === '1.1.1.1', 'nf_action clean: ' + JSON.stringify(m && m.groups.nf_action));
}
// 9. Web Protection tab: the decisions of the proxy, the antivirus, the sandbox and the category block page
ok(X.TABS.some(t => t.id === 'webprot' && t.kind === 'webprot'), 'webprot tab exists');
X.setLang('en');
let w = X.classifyWebProt({app_name:'nexwall-av', _msg:'page-blocked client=192.168.1.20 host=casadeapostas.com category=gambling ref=BCCFD8F9 rule=BP test'});
ok(w.ev === 'page' && w.cls === 'block' && w.client === '192.168.1.20' && w.target === 'casadeapostas.com' && /gambling/.test(w.detail) && /BCCFD8F9/.test(w.detail) && /BP test/.test(w.detail), 'block page line: ' + JSON.stringify(w));
w = X.classifyWebProt({app_name:'nexwall-av', _msg:'page-blocked client=10.0.0.5 host=x.example category=gambling rule=Staff'});
ok(w.ev === 'page' && !/Reference/.test(w.detail), 'block page line without a reference (older versions)');
w = X.classifyWebProt({app_name:'nexwall-av', _msg:'blocked client=192.168.1.150 reason=infected clamav: Eicar-Test-Signature; yara: eicar size=68'});
ok(w.ev === 'av' && w.cls === 'block' && /Eicar/.test(w.detail), 'antivirus block');
w = X.classifyWebProt({app_name:'nexwall-av', _msg:'blocked client=192.168.1.150 reason=sandbox the sandbox judged it malicious size=2048'});
ok(w.ev === 'sandbox', 'sandbox hold block');
w = X.classifyWebProt({app_name:'nexwall-sandbox', _msg:'verdict sha=0123456789abcdef verdict=malicious client=192.168.1.9 name=setup.exe'});
ok(w.ev === 'verdict' && w.cls === 'block' && w.target === 'setup.exe', 'sandbox verdict');
w = X.classifyWebProt({app_name:'squid-web', _msg:'1791471154.601      0 192.168.1.242 NONE_NONE/409 3907 CONNECT assets.msn.com:443 - HIER_NONE/- text/html'});
ok(w.ev === 'proxy' && w.client === '192.168.1.242' && w.target === 'assets.msn.com:443' && /does not match/.test(w.detail), 'proxy 409: ' + JSON.stringify(w));
w = X.classifyWebProt({app_name:'nexwall-web-guard', _msg:'license token valid, SSL inspection and family options active'});
ok(w.ev === 'service' && w.detail.length > 0, 'service line');
X.setLang('pt-BR'); w = X.classifyWebProt({app_name:'nexwall-av', _msg:'page-blocked client=1.1.1.1 host=a.b category=gambling ref=AAAA1111 rule=R'}); ok(/Categoria gambling, regra R/.test(w.detail) && /Referência AAAA1111/.test(w.detail), 'pt-BR detail: ' + w.detail); X.setLang('en');
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); 
// 10. Web Protection tab shows all web traffic: allowed (tunnel, inspected), blocked and refused
{
  const sq = (m) => X.classifyWebProt({app_name:'squid-web', _msg:m});
  let a = sq('1791474690.123    120 192.168.1.242 TCP_TUNNEL/200 5120 CONNECT www.youtube.com:443 - HIER_DIRECT/142.250.1.1 -');
  ok(a.ev === 'web_tunnel' && a.cls === 'allow' && a.target === 'www.youtube.com:443' && a.client === '192.168.1.242', 'tunnel is allowed traffic: ' + JSON.stringify(a));
  a = sq('1791474690.123    120 192.168.1.242 TCP_MISS/200 5120 GET https://example.org/index.html - HIER_DIRECT/1.2.3.4 text/html');
  ok(a.ev === 'web_allowed' && a.cls === 'allow' && a.target === 'example.org', 'inspected request is allowed traffic: ' + JSON.stringify(a));
  a = sq('1791474690.123    2 192.168.1.242 NONE_NONE/403 0 GET http://casadeapostas.com/ - HIER_NONE/- -');
  ok(a.ev === 'web_blocked' && a.cls === 'block', '403 is blocked: ' + JSON.stringify(a));
  a = sq('1791474690.123    2 192.168.1.242 NONE_NONE/409 0 CONNECT fonts.googleapis.com:443 - HIER_NONE/- -');
  ok(a.ev === 'proxy' && /does not match/.test(a.detail), '409 is a refusal: ' + a.detail);
  for (const l of ['en','es','pt-BR']) for (const k of ['wp.services','wp.ev.web_allowed','wp.ev.web_tunnel','wp.ev.web_blocked']) ok(X.I18N[l][k], l + ': ' + k);
}
process.exit(fail?1:0);

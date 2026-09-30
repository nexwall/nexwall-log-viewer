// Runs the page's real script against a stub DOM. Usage: node tests/viewer-test.js
const vm = require('vm'), fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname,'..','deploy/www-ns/logs-viewer/index.html'),'utf8');
const js = html.match(/<script>([\s\S]*)<\/script>/)[1];
const els = {};
const mk = () => new Proxy(function(){}, { get:(t,k)=> k==='style'?{}: k==='dataset'?{}: k==='classList'?{toggle(){}}: k==='children'?[]: k==='value'?'': k==='checked'?true: (k in t ? t[k] : (k==='querySelectorAll' ? ()=>[] : function(){})), set:(t,k,v)=>{t[k]=v;return true}, apply:()=>undefined });
const doc = { getElementById:id=>els[id]||(els[id]=mk()), querySelectorAll:()=>[], documentElement:{}, createElement:()=>mk() };
const store = {};
const ctx = { document:doc, window:{addEventListener(){}}, navigator:{language:'en-US'}, location:{search:'', pathname:'/logs-viewer/'}, history:{replaceState(){}},
  sessionStorage:{getItem:k=>store[k]||null,setItem:(k,v)=>store[k]=v}, URLSearchParams, fetch:()=>Promise.reject(new Error('no net')),
  setInterval(){return 1}, clearInterval(){}, setTimeout(){}, console, Blob:function(){}, URL:{createObjectURL(){},revokeObjectURL(){}} };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(js + '\n;globalThis.__x = {I18N,t,describeReason,tReason,classify,parseAuth,cleanAction,macsOf,TABS,setLang:(l)=>{LANG=l}};', ctx);
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
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail?1:0);

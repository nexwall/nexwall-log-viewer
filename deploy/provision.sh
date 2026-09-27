#!/bin/sh
# Nexwall Log Viewer - provisioning script for the Nexwall firewall itself.
# Idempotent-ish: safe to re-run. Run as root on the Nexwall box.
# Does NOT touch Snort/DPI/adblock's own rule engines beyond documented UCI toggles.
set -e

echo "== 1. VictoriaLogs binary + service =="
if [ ! -x /usr/bin/victoria-logs ]; then
  echo "victoria-logs binary missing - download the linux-amd64 release from"
  echo "https://github.com/VictoriaMetrics/VictoriaLogs/releases and place it at /usr/bin/victoria-logs"
  exit 1
fi
mkdir -p /mnt/data/victoria-logs-data
cp -n "$(dirname "$0")/../victoria-logs/victoria-logs.uci" /etc/config/victoria-logs 2>/dev/null || true
cp "$(dirname "$0")/../victoria-logs/victoria-logs.init" /etc/init.d/victoria-logs
chmod +x /etc/init.d/victoria-logs
/etc/init.d/victoria-logs enable
/etc/init.d/victoria-logs start

echo "== 2. rsyslog: forward everything + tail Snort JSON alerts =="
cp "$(dirname "$0")/rsyslog/nexwall-extra.conf" /etc/rsyslog.d/nexwall-extra.conf
uci -q batch <<UCI
set rsyslog.victorialogs=forwarder
set rsyslog.victorialogs.source='*.*'
set rsyslog.victorialogs.target='127.0.0.1'
set rsyslog.victorialogs.port='5140'
set rsyslog.victorialogs.protocol='udp'
set rsyslog.victorialogs.rfc='3164'
add_list rsyslog.syslog.includes='/etc/rsyslog.d/nexwall-extra.conf'
commit rsyslog
UCI
/etc/init.d/rsyslog restart

echo "== 3. Firewall traffic logging (Tráfego de Firewall / Threat Shield tabs) =="
uci -q batch <<UCI
set firewall.ns_wan.log='1'
set firewall.ns_wan.log_limit='30/minute'
set firewall.ns_lan.log='1'
set firewall.ns_lan.log_limit='30/minute'
set firewall.ns_allow_https.log='1'
set firewall.ns_allow_ui.log='1'
commit firewall
UCI
/etc/init.d/firewall reload

echo "== 4. DPI blocked-connection logging =="
uci set dpi.config.log_blocked='1'
uci commit dpi
/etc/init.d/dpi restart || true

echo "== 5. Snort test alerts (optional, safe - ICMP only) =="
echo "   uci set snort.snort.ns_testing='1'; uci commit snort; /etc/init.d/snort restart"

echo "== 6. DNS query logging (DNS Protection tab) =="
uci set dhcp.@dnsmasq[0].logqueries='1'
uci commit dhcp
/etc/init.d/dnsmasq restart

echo "== 7. nginx wiring =="
cp nginx/logs-viewer.inc /etc/nginx/conf.d/logs-viewer.inc
grep -q "logs-viewer.inc" /etc/nginx/conf.d/ns-ui.conf || \
  sed -i "s#include /etc/nginx/conf.d/ns-ui-api.inc;#include /etc/nginx/conf.d/ns-ui-api.inc;\n\tinclude /etc/nginx/conf.d/logs-viewer.inc;#" /etc/nginx/conf.d/ns-ui.conf
cp nginx/nexwall-logviewer-ensure.sh /usr/bin/nexwall-logviewer-ensure.sh
chmod +x /usr/bin/nexwall-logviewer-ensure.sh
(crontab -l 2>/dev/null | grep -v nexwall-logviewer-ensure; echo "*/2 * * * * /usr/bin/nexwall-logviewer-ensure.sh") | crontab -
/etc/init.d/nginx reload

echo "== 8. Deploy the page itself =="
mkdir -p /www-ns/logs-viewer
cp www-ns/logs-viewer/index.html /www-ns/logs-viewer/index.html

echo "Done. Open https://<lan-ip>:9090/logs-viewer/"

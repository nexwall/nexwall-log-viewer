#!/bin/sh
# Nexwall Log Viewer - provisioning script for the NEXWALL FIREWALL ITSELF
# (not the dev/build server this repo lives on). Run as root, on the box
# that will actually serve the log viewer.
#
# Safe-ish to re-run (uci sets are idempotent; file copies overwrite).
# Does NOT touch Snort/DPI/adblock's own rule engines beyond the documented
# UCI toggles below - it only wires logging/ingestion, not detection logic.
#
# Tested against: Nexwall 26.0.0-rc1, x86_64, apk-tools 3.0.5.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VL_VERSION="v1.52.0"
VL_ARCH="linux-amd64"   # change if the firewall isn't x86_64

echo "== 0. Dependency check =="
missing=""
for bin in nginx rsyslogd curl uci; do
  command -v "$bin" >/dev/null 2>&1 || missing="$missing $bin"
done
if [ -n "$missing" ]; then
  echo "Missing required binaries:$missing"
  echo "These ship with the nginx-ssl and rsyslog apk packages on Nexwall - install them first."
  exit 1
fi
if ! [ -e /usr/lib/rsyslog/imfile.so ]; then
  echo "rsyslog's imfile module (usr/lib/rsyslog/imfile.so) is missing - the"
  echo "IPS/IDS tab needs it to tail Snort's JSON alert files. It ships with"
  echo "the standard 'rsyslog' apk package on this build; if it's absent here,"
  echo "check whether it was split into a separate package in your build."
  exit 1
fi

echo "== 1. VictoriaLogs binary + service (VictoriaLogs is a hard dependency -"
echo "      the whole log viewer queries it locally on 127.0.0.1:9428; nothing"
echo "      works without it running ON THIS FIREWALL) =="
if [ ! -x /usr/bin/victoria-logs ]; then
  echo "Downloading victoria-logs $VL_VERSION ($VL_ARCH)..."
  TMPD="$(mktemp -d)"
  curl -sL -o "$TMPD/vl.tar.gz" \
    "https://github.com/VictoriaMetrics/VictoriaLogs/releases/download/${VL_VERSION}/victoria-logs-${VL_ARCH}-${VL_VERSION}.tar.gz"
  tar xzf "$TMPD/vl.tar.gz" -C "$TMPD"
  mv "$TMPD/victoria-logs-prod" /usr/bin/victoria-logs
  chmod +x /usr/bin/victoria-logs
  rm -rf "$TMPD"
else
  echo "victoria-logs already present: $(/usr/bin/victoria-logs -version 2>&1 | tail -1)"
fi
mkdir -p /mnt/data/victoria-logs-data
[ -f /etc/config/victoria-logs ] || cp "$SCRIPT_DIR/victoria-logs/victoria-logs.uci" /etc/config/victoria-logs
cp "$SCRIPT_DIR/victoria-logs/victoria-logs.init" /etc/init.d/victoria-logs
chmod +x /etc/init.d/victoria-logs
/etc/init.d/victoria-logs enable
/etc/init.d/victoria-logs start

echo "== 2. rsyslog: forward everything + tail Snort JSON alerts =="
cp "$SCRIPT_DIR/rsyslog/nexwall-extra.conf" /etc/rsyslog.d/nexwall-extra.conf
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
if uci -q get dpi.config >/dev/null 2>&1; then
  uci set dpi.config.log_blocked='1'
  uci commit dpi
  /etc/init.d/dpi restart || true
else
  echo "dpi package/config not found - skipping (DPI tab will just be empty)"
fi

echo "== 5. Snort test alerts (OPTIONAL, off by default - generates alerts for"
echo "      ICMP traffic, harmless, useful to prove the IPS/IDS tab end-to-end"
echo "      on a box with no real attack traffic). To enable:"
echo "      uci set snort.snort.ns_testing='1'; uci commit snort; /etc/init.d/snort restart"

echo "== 6. DNS query logging (DNS Protection tab) =="
if uci -q get dhcp.@dnsmasq[0] >/dev/null 2>&1; then
  uci set dhcp.@dnsmasq[0].logqueries='1'
  uci commit dhcp
  /etc/init.d/dnsmasq restart
else
  echo "dhcp.@dnsmasq[0] not found - skipping (DNS Protection tab will just be empty)"
fi

echo "== 7. nginx wiring =="
cp "$SCRIPT_DIR/nginx/logs-viewer.inc" /etc/nginx/conf.d/logs-viewer.inc
grep -q "logs-viewer.inc" /etc/nginx/conf.d/ns-ui.conf || \
  sed -i "s#include /etc/nginx/conf.d/ns-ui-api.inc;#include /etc/nginx/conf.d/ns-ui-api.inc;\n\tinclude /etc/nginx/conf.d/logs-viewer.inc;#" /etc/nginx/conf.d/ns-ui.conf
cp "$SCRIPT_DIR/nginx/nexwall-logviewer-ensure.sh" /usr/bin/nexwall-logviewer-ensure.sh
chmod +x /usr/bin/nexwall-logviewer-ensure.sh
(crontab -l 2>/dev/null | grep -v nexwall-logviewer-ensure; echo "*/2 * * * * /usr/bin/nexwall-logviewer-ensure.sh") | crontab -
nginx -t -c /etc/nginx/uci.conf && /etc/init.d/nginx reload

echo "== 8. Deploy the page itself =="
mkdir -p /www-ns/logs-viewer
cp "$SCRIPT_DIR/www-ns/logs-viewer/index.html" /www-ns/logs-viewer/index.html

echo
echo "Done. Open https://<lan-ip>:9090/logs-viewer/"

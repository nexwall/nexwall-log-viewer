#!/bin/sh
# Ensures the Log Viewer nginx include stays wired into ns-ui.conf.
# Something in this environment (ns.reverseproxy activity) occasionally
# rewrites ns-ui.conf and drops manual includes, so this self-heals it
# instead of relying on a one-time edit. Runs via cron every 2 minutes.
CONF="/etc/nginx/conf.d/ns-ui.conf"
INC="include /etc/nginx/conf.d/logs-viewer.inc;"
[ -f "$CONF" ] || exit 0
if ! grep -qF "$INC" "$CONF"; then
    sed -i "s#include /etc/nginx/conf.d/ns-ui-api.inc;#include /etc/nginx/conf.d/ns-ui-api.inc;\n\t$INC#" "$CONF"
    nginx -t -c /etc/nginx/uci.conf >/dev/null 2>&1 && /etc/init.d/nginx reload >/dev/null 2>&1
fi

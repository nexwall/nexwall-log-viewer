# Nexwall Log Viewer

A consolidated, click-to-filter log viewer for the Nexwall Firewall, built on
[VictoriaLogs](https://docs.victoriametrics.com/victorialogs/). One static page (no build step, no CDN), served by the
firewall's own web server and opened from **Logs -> Open Log Viewer** in the Nexwall interface in a new window.

**Status:** integrated in the firewall build (`ns-log-viewer`, `victoria-logs`, `ns.log-viewer`, the `/api/logs` and
`/api/trace` routes of the management API). This repository is the source of the page and of the notes on how it works;
the copy that ships is `firewall-msp/packages/ns-log-viewer/files/www-ns/logs-viewer/index.html` (kept identical).

## How it is wired

```
Browser (new window) -> https://<fw>:9090/logs-viewer/            static page (nginx include, only when enabled)
                     -> /api/logs/query   (JWT) -> management API -> VictoriaLogs 127.0.0.1:9428
                     -> /api/trace/*      (JWT) -> management API -> fwtrace / drppkt (root, constrained)
rsyslog *.*  -> VictoriaLogs syslog listener 127.0.0.1:5140          (kernel/firewall, dnsmasq, dropbear, nginx, ...)
rsyslog imfile -> Snort JSON alerts                                     (IPS tab)
```

* **Off by default.** VictoriaLogs and the extra log inputs only run after an administrator presses *Open Log Viewer*
  (`ns.log-viewer enable`); *disable* removes everything again. It costs real CPU and disk, so idle units do not pay it.
* **Authentication.** The page has no login of its own. The main interface hands over its session token once
  (`?token=`, plus `?lang=`); the page keeps it in `sessionStorage` for that tab, strips it from the address bar, and
  sends it as a Bearer header. The management API validates it on every request exactly as for the main interface,
  so an expired or missing session gets HTTP 401 and a message, not data. VictoriaLogs itself listens on localhost only.
* **Languages:** English, Spanish, Brazilian Portuguese (follows the interface; selectable in the header).
* **Dark/light** follows the system. **Export CSV** writes what is on screen. `?debug=1` shows the query diagnostics
  box (hidden otherwise; it also appears by itself when a request fails).

## Tabs

Each module tab shows only the *decisions* of that service; the raw, unfiltered stream is always in *System logs*.

| Tab | Source | Notes |
|---|---|---|
| Firewall traffic | kernel `nft log` lines | Action, **Reason**, source/destination, protocol, interfaces, source MAC in details; a *trace* link opens the live tracer for that flow |
| IP & Geo Blocking | kernel lines with the `banIP/...` prefix | reason names the direction and the list that matched |
| IPS / IDS | Snort JSON alerts (imfile) | |
| DPI | kernel lines with the `DPI block` prefix | the application name is not in the kernel line (see gaps) |
| DNS Filtering | dnsmasq `... is NXDOMAIN` | blocks only |
| VPN | OpenVPN / strongSwan connection and authentication events | keepalive chatter filtered out |
| High Availability | keepalived / conntrackd / ns-ha | empty until an HA pair is configured (not exercised on the test unit) |
| Reverse Proxy | nginx access lines of published domains | client, request, status, bytes |
| Authentication | SSH (dropbear) and web/API logins | success/failure, user, source |
| Admin activity | management-API calls that change configuration | secrets are masked by the API before logging |
| System logs | everything | |
| **Live rule trace** (`fwtrace`) / **Packet path** (`drppkt`) | run on demand via `/api/trace` | decision, the rule's name and the reason, per flow; observe-only |

### The reason column

The firewall's log prefix *is* the reason: `Allow-HTTPS-from-WAN:` (a rule with logging on carries its own name),
`reject wan in` (zone policy), `banIP/inbound/drop/<list>`, `DPI block`. The page turns these into sentences. To see the
exact rule for any row, use its *trace* link.

## Tests

`node tests/viewer-test.js` runs the page's real script against a stub DOM: translation completeness for every key and tab,
reason text in all languages, login parsing, MAC parsing. The LogsQL of every tab was also executed against a real
VictoriaLogs (a synthetic nginx access line was injected to check the reverse-proxy extraction).

## Known limits

* No application name on DPI rows, no byte counts, no per-rule log unless the rule has logging enabled (see
  `firewall-msp/../msp/LOG_VIEWER.md` in the internal repo for the gap list against commercial log viewers).
* Fields are extracted at query time with `extract_regexp`: fine for hours and days, slower over long ranges.
* `deploy/provision.sh` is the original manual installer from the prototype; the firewall build supersedes it.

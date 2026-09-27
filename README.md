# Nexwall Log Viewer

> **Status: proposal / working prototype, built for developer review.**
> Everything described here was investigated and implemented end-to-end
> against a real Nexwall test box (see "How this was validated" below), but
> it has not gone through Nexwall's own engineering review, code style, or
> release process. Treat this as a working spec + reference implementation
> to evaluate, adapt, or reject - not as something to deploy to a customer
> firewall as-is.

Consolidated, Sophos-style log viewer for Nexwall, built on top of
[VictoriaLogs](https://docs.victoriametrics.com/victorialogs/). Single static
page, no build step, served from the same nginx/port/TLS as the Nexwall UI
(`https://<lan-ip>:9090/logs-viewer/`), backed by a reverse-proxied
VictoriaLogs LogsQL API.

## Dependencies

Everything below must be present **on the Nexwall firewall itself** (this
dev-server repo just holds the source; nothing here runs on the dev server).
Versions are what this was built and tested against - the code doesn't
hard-depend on these exact versions, they're just what's confirmed working.

| Dependency | Role | Confirmed version | Ships with Nexwall by default? |
|---|---|---|---|
| **VictoriaLogs** | Log storage + LogsQL query engine. **Hard dependency - see below.** | v1.52.0 (linux-amd64) | **No** - not in the apk feed, installed manually (see `deploy/provision.sh`) |
| nginx | Serves the page + reverse-proxies the VictoriaLogs API | 1.26.3 (`nginx-ssl` package) | Yes (it's what serves the Nexwall UI itself, port 9090) |
| rsyslog + `imfile` module | Ships every log line to VictoriaLogs; `imfile` tails Snort's JSON alert files | rsyslogd 8.2506.0 | Yes - `imfile.so` is part of the base `rsyslog` apk package, no extra install needed |
| snort3 | IPS/IDS engine (source for the IPS/IDS tab) | 3.10.0.0-r1 | Yes, if the IPS feature is enabled on the box |
| netifyd | DPI engine (source for the DPI tab) | 5.2.8-r1 | Yes, if DPI is enabled |
| adblock + dnsmasq-full | DNS-layer blocking + query logging (source for the DNS Protection tab) | adblock 4.5.5-r5, dnsmasq-full 2.93-r1 | Yes |
| openvpn-openssl + strongswan | VPN daemons (source for the VPN tab) | openvpn 2.7.4-r3, strongswan 6.0.3-r1 | Yes, if VPN is configured |
| `apk-tools` (not `opkg`) | Package manager used to fetch/verify what's above | 3.0.5 | Yes - this Nexwall build has already moved off OpenWrt's classic `opkg` |
| A browser with `fetch()` and `<template>` support | Runs the frontend | any current browser | n/a |

No node/npm/build toolchain, no framework, no external CDN scripts - the
page is one self-contained HTML file.

## Does VictoriaLogs need to be installed on the firewall?

**Yes, unconditionally.** It is not optional and not something the page can
work around. Concretely:

- The page's JavaScript calls `/logs-viewer/api/...`, which nginx
  `proxy_pass`es straight to `http://127.0.0.1:9428` - i.e. **the VictoriaLogs
  HTTP API running on that same firewall**. There is no remote/shared
  VictoriaLogs instance involved anywhere in this design.
- Every tab, including the plain "Logs do Sistema" tab, is a LogsQL query
  against that local instance. Without it running, every tab shows the
  on-page network-error debug banner and nothing else - the static HTML/CSS
  loads fine (that's the "I only see the interface" failure mode encountered
  during development), but there is zero log data to show.
- It is **not currently packaged for Nexwall** (no apk package exists in the
  feeds checked). `deploy/provision.sh` downloads the official upstream
  binary release directly from GitHub and wires it up as a procd service
  (`deploy/victoria-logs/victoria-logs.init` + `.uci`). If Nexwall ever ships
  its own `victoria-logs` or `victoria-logs-single` apk package, swap that in
  and drop the manual-download step in the provisioning script.
- Sizing/retention is whatever `deploy/victoria-logs/victoria-logs.uci` says
  (30 days, stored under `/mnt/data/victoria-logs-data`) - adjust for the
  target box's disk and expected log volume before using this on anything
  bigger than a test unit.

## Why this exists

The stock VictoriaLogs `vmui` is a generic LogsQL explorer — great for ad-hoc
queries, not a firewall log viewer. This project adds:

- Structured, clickable columns (source/destination IP, port, protocol,
  action) instead of raw log lines.
- Click-to-filter chips, like Sophos's log viewer.
- One consolidated view across every security module on the box instead of
  seven different places to look.

## Tabs / data sources

| Tab | Source | Ingestion | Status as tested |
|---|---|---|---|
| Tráfego de Firewall | fw4/nftables reject-drop-accept logs (kernel) | `imklog` → rsyslog `*.*` forwarder → VictoriaLogs syslog listener | Live, real traffic |
| Threat Shield / GeoIP | banIP (`nft log prefix "banIP/..."`) | same kernel pipeline, filtered on `nf_action:~"banip"` | Wired, no blocks fired yet in this test env |
| IPS / IDS | Snort3 JSON alerts (`/var/log/snort/*_alert_json.txt`) | `rsyslog imfile` tails the JSON files, tag `snort-ips` | Wired; Snort only inspects the **forward** chain, so alerts need real LAN↔WAN traffic hitting a rule (self-originated traffic from the box doesn't count) |
| DPI | netifyd | `dpi.config.log_blocked=1` → syslog | Live, but currently dominated by a `netify-api` bootstrap/licensing error, not real traffic classification — see Known limitations |
| Proteção DNS | dnsmasq + adblock | `dhcp.@dnsmasq[0].logqueries=1` → syslog | Live queries flowing; adblock feeds were configured but not yet actively blocking in this test env |
| VPN | OpenVPN + IPsec/strongSwan (`charon`) | both already log to syslog by default | Live — real IKE traffic observed during testing |
| Logs do Sistema | everything | no filter | Live |

## Architecture

```
Browser  →  nginx :9090 (same TLS as ns-ui)
              ├─ /logs-viewer/         → static index.html (this repo)
              └─ /logs-viewer/api/     → proxy_pass → 127.0.0.1:9428 (VictoriaLogs)

rsyslog *.*  → 127.0.0.1:5140 (VictoriaLogs syslog listener)
rsyslog imfile → tails Snort JSON alert files → same pipe
```

The frontend is a single `index.html` (vanilla JS, no framework, no build
step) with a small per-tab config array (`TABS` in the `<script>`) describing
how to build the LogsQL query and how to render rows for each of three
generic "kinds": `netfilter` (regex-extracted kernel firewall lines),
`ips` (JSON-unpacked Snort alerts), `simple` (plain syslog line list).

Firewall traffic fields (SRC, DST, PROTO, SPT, DPT...) are extracted
**at query time** via LogsQL's `extract_regexp`, not at ingestion time — raw
logs are stored as-is, so nothing is lost and the extraction pattern can
change without re-ingesting anything.

## Deploying

See `deploy/provision.sh` — idempotent-ish shell script meant to run **on
the Nexwall firewall itself** (not this dev server). It:

0. Checks for required binaries/modules (nginx, rsyslogd, `imfile.so`, curl, uci).
1. Downloads and installs the VictoriaLogs binary if it isn't already present,
   and wires it up as a procd service.
2. Wires rsyslog to forward everything + tail Snort's JSON alerts.
3. Enables firewall/DPI/DNS logging via UCI (see `deploy/*` for exact values).
4. Wires the nginx include into `ns-ui.conf` and installs a cron self-heal
   (see "Known limitations" below for why that's needed).
5. Copies `deploy/www-ns/logs-viewer/index.html` into place.

## Known limitations (honest, as tested on this build)

- **`ns-ui.conf` gets rewritten out from under manual edits.** Something in
  this environment (looked like `ns.reverseproxy` activity, triggered by a
  firewall reload touching the `Allow-HTTPS`/`Allow-UI` rules) periodically
  regenerates `/etc/nginx/conf.d/ns-ui.conf` and drops the include line for
  this project. `deploy/nginx/nexwall-logviewer-ensure.sh` self-heals it via
  cron every 2 minutes. This is a workaround, not a fix — the real fix would
  be upstream, in whatever regenerates that file.
- **No authentication of its own.** The page sits behind the same TLS
  listener as the Nexwall UI but does not share its login session. Fine for
  a LAN-only test box; add HTTP Basic Auth in `deploy/nginx/logs-viewer.inc`
  before using this anywhere less trusted.
- **IPS/IDS and DPI need real traffic to say anything.** Both only inspect
  routed (forward-chain) LAN↔WAN traffic; testing from a shell on the box
  itself doesn't exercise that path.
- **DPI tab is currently noisy.** netifyd's `netify-api` bootstrap keeps
  failing with "Agent not provisioned" (a licensing/registration issue, out
  of scope for this project) and that message dominates the tab until a real
  blocked flow occurs.
- **This is not integrated into the Nexwall Vue SPA.** It's a same-origin
  static page reachable at the same host/port/certificate, which is close
  enough for day-to-day use, but it doesn't appear in the SPA's own left nav
  because that would require touching `nexwall-ui`'s source, which this
  project intentionally does not do.
- LogsQL syntax notes for anyone extending this: `extract_regexp` patterns
  reject `\S`/`\d`-style shorthand classes — use `[^ ]+`/`[0-9]+` instead.
  Fields created by `extract_regexp`/`unpack_json` only exist *after* that
  pipe stage — any `filter` on them (including click-to-filter chips) must
  come after it in the query, not before.

## How this was validated

Built and tested live against a real Nexwall test firewall (Nexwall
26.0.0-rc1, x86_64), not just written from documentation:

- Every UCI/config change in `deploy/provision.sh` was run for real on that
  box, one step at a time, with the resulting nftables rules / rsyslog
  output / VictoriaLogs ingestion checked after each step.
- Each tab's LogsQL query was executed directly against the VictoriaLogs API
  (`curl .../select/logsql/query`) with real data before being wired into
  the frontend, and the frontend's own debug panel (the small amber box
  under the toolbar) was used to catch a real bug during review: click-to-
  filter chips were being applied *before* the `extract_regexp`/`unpack_json`
  pipe stage that creates the fields they filter on, so every click silently
  returned zero rows. Fixed by moving chip filters to a `filter` stage after
  extraction - see the LogsQL notes in "Known limitations" below.
- `provision.sh` itself has only been syntax-checked (`sh -n`) on the dev
  server, not run end-to-end as a single script on a fresh box - it was
  built by extracting the exact sequence of individually-tested commands
  above, but a clean run-through is still worth doing before trusting it
  blindly.

## Repo scope

This repo only covers the log viewer (frontend + the rsyslog/nginx/UCI glue
it depends on). It does not modify `nexwall-ui`, `nexwall-monitoring`, or
any other project on this dev server.

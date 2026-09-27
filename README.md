# Nexwall Log Viewer

Consolidated, Sophos-style log viewer for Nexwall, built on top of
[VictoriaLogs](https://docs.victoriametrics.com/victorialogs/). Single static
page, no build step, served from the same nginx/port/TLS as the Nexwall UI
(`https://<lan-ip>:9090/logs-viewer/`), backed by a reverse-proxied
VictoriaLogs LogsQL API.

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

1. Installs/starts VictoriaLogs (binary must be placed manually — see script).
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

## Repo scope

This repo only covers the log viewer (frontend + the rsyslog/nginx/UCI glue
it depends on). It does not modify `nexwall-ui`, `nexwall-monitoring`, or
any other project on this dev server.

# Babelcast

A server which allows audio publishers to broadcast to subscribers on a channel, using nothing more than a modern web browser.

It uses websockets for signalling & WebRTC for audio.

The designed use case is for live events where language translation is happening.
A translator would act as a publisher and people wanting to hear the translation would be subscribers.

## Building

Download a [precompiled binary](https://github.com/porjo/babelcast/releases/latest) or build it yourself.

## Usage

```
Usage of ./babelcast:
  -caddy-domain string
        if set, ensure Caddy is running and reverse-proxying this domain to -port over HTTPS
  -debug
        enable debug log
  -port int
        listen on this port (default 8080)
```

Then point your web browser to `http://localhost:8080/`

If the `PUBLISHER_PASSWORD` environment variable is set, then publishers will be required to enter the
password before they can connect.

### TLS

Except when testing against localhost, web browsers require that TLS (`https://`) be in use any time media devices (e.g. microphone) are in use, and mobile OSes require it for lock-screen media controls (Media Session API). You should put Babelcast behind a reverse proxy that can provide SSL certificates e.g. [Caddy](https://github.com/caddyserver/caddy).

See this [Stackoverflow post](https://stackoverflow.com/a/34198101/202311) for more information.

#### Built-in Caddy integration

Pass `-caddy-domain` and Babelcast will make sure [Caddy](https://github.com/caddyserver/caddy) is running as a reverse proxy in front of it, obtaining an HTTPS certificate automatically:

```
sudo ./babelcast -port 8080 -caddy-domain li.ve
```

(`sudo` is required so Caddy can bind ports 80/443 — see below.)

This requires `caddy` to be installed and in `PATH` (e.g. `brew install caddy` on macOS). On startup, Babelcast checks whether Caddy is already running (via its admin API on `127.0.0.1:2019`):
- If it's already running, Babelcast leaves it alone and just starts normally.
- If not, Babelcast generates a Caddyfile reverse-proxying `<domain> -> 127.0.0.1:<port>` and launches Caddy itself. Caddy keeps running in the background independent of Babelcast — restarting Babelcast won't restart Caddy, and stopping Babelcast doesn't stop Caddy either.

You still need to forward WAN ports `80` and `443` (TCP) from your router to the server's LAN IP, and have `-caddy-domain`'s DNS pointing at your public IP — Caddy needs port 80 for the ACME challenge and 443 to serve. Give the server a DHCP reservation/static LAN IP so the forwarding rule doesn't break later.

**Ports below 1024 require root.** If you run Babelcast unprivileged (no `sudo`), Caddy will fail to bind 80/443 and you'll see a permission error in the log — Babelcast keeps working on its own port regardless, just without HTTPS in front of it. Run with `sudo` to let Caddy bind those ports.

If you'd rather manage Caddy yourself (e.g. as an always-on `brew services` daemon, decoupled from Babelcast entirely), `deploy/Caddyfile` is a static example of the same config — symlink it into place and start Caddy independently instead of using `-caddy-domain`.

### Using Publisher on a different computer in the same network

If you want to stream audio through a different device then the server , you may need to visit `chrome://flags/#unsafely-treat-insecure-origin-as-secure` and add `http://192...` or `http://li.ve` to the list so that Chrome allows you to use the microphone.

## Credit

Thanks to the excellent [Pion](https://github.com/pion/webrtc) library for making WebRTC so accessible.

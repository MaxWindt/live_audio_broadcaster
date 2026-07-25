package main

import (
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/exec"
	"time"
)

const caddyAdminAddr = "127.0.0.1:2019"

// ensureCaddy makes sure a Caddy instance is reverse-proxying domain to
// 127.0.0.1:port over HTTPS. If Caddy is already running (its admin API
// answers), it's left as-is. Otherwise a new Caddy process is started and
// left running in the background, independent of babelcast's lifetime.
func ensureCaddy(domain string, port int) {
	if isCaddyRunning() {
		slog.Info("caddy already running, leaving it as-is")
		return
	}

	cfgFile, err := writeCaddyfile(domain, port)
	if err != nil {
		slog.Error("could not write Caddyfile, skipping caddy autostart", "err", err)
		return
	}

	cmd := exec.Command("caddy", "run", "--config", cfgFile, "--adapter", "caddyfile")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		slog.Error("failed to start caddy - is it installed (brew install caddy)? HTTPS will be unavailable", "err", err)
		return
	}
	slog.Info("started caddy", "domain", domain, "pid", cmd.Process.Pid)

	go func() {
		err := cmd.Wait()
		slog.Warn("caddy process exited", "err", err)
	}()
}

func isCaddyRunning() bool {
	conn, err := net.DialTimeout("tcp", caddyAdminAddr, 500*time.Millisecond)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

func writeCaddyfile(domain string, port int) (string, error) {
	content := fmt.Sprintf("%s {\n\treverse_proxy 127.0.0.1:%d\n}\n", domain, port)
	f, err := os.CreateTemp("", "babelcast-caddyfile-*")
	if err != nil {
		return "", err
	}
	defer f.Close()
	if _, err := f.WriteString(content); err != nil {
		return "", err
	}
	return f.Name(), nil
}

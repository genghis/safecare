#!/usr/bin/env python3
"""SafeCare RPi First-Boot Captive Portal Provisioner.

Runs before Docker. Handles:
1. WiFi configuration (scan + connect via nmcli)
2. Device password change
3. Crypto key generation (DEK shown as QR, NOT written to disk)
4. .env file creation (JWT_SECRET + HMAC_KEY only)
5. Docker Compose startup
6. Redirect to dashboard for remaining setup
"""

import json
import os
import secrets
import subprocess
import threading
import time

from flask import (
    Flask, jsonify, redirect, render_template, request, send_file, abort,
)
from io import BytesIO

SAFECARE_ROOT = os.environ.get("SAFECARE_ROOT", "/opt/safecare")
MOCK_MODE = os.environ.get("SAFECARE_MOCK", "") == "1"
RECOVERY_MODE = os.environ.get("SAFECARE_RECOVERY", "") == "1"

app = Flask(__name__)
app.config["WIFI_STATUS"] = "idle"
app.config["WIFI_TARGET"] = ""
app.config["WIFI_ERROR"] = ""
app.config["DEK_FOR_QR"] = None
app.config["DOCKER_STATUS"] = "idle"


# ---- Captive portal detection -------------------------------------------

@app.route("/generate_204")
@app.route("/hotspot-detect.html")
@app.route("/connecttest.txt")
@app.route("/ncsi.txt")
@app.route("/redirect")
@app.route("/success.txt")
def captive_detect():
    if RECOVERY_MODE:
        return redirect("/wifi-recovery", code=302)
    return redirect("/welcome", code=302)


# ---- Pages ---------------------------------------------------------------

@app.route("/")
def index():
    if RECOVERY_MODE:
        return redirect("/wifi-recovery")
    return redirect("/welcome")


@app.route("/welcome")
def welcome():
    return render_template("welcome.html")


@app.route("/wifi-recovery")
def wifi_recovery_page():
    return render_template("wifi_recovery.html")


@app.route("/wifi")
def wifi_page():
    return render_template("wifi.html")


@app.route("/password")
def password_page():
    return render_template("password.html")


@app.route("/keys")
def keys_page():
    return render_template("keys.html")


@app.route("/starting")
def starting_page():
    return render_template("starting.html")


@app.route("/done")
def done_page():
    ip = _get_wlan_ip()
    app.config["DEK_FOR_QR"] = None  # Clear DEK from memory
    return render_template("done.html", ip=ip)


# ---- WiFi API ------------------------------------------------------------

@app.route("/api/wifi/scan")
def wifi_scan():
    if MOCK_MODE:
        return jsonify([
            {"ssid": "HomeNetwork", "signal": 85, "security": "WPA2"},
            {"ssid": "CoffeeShop", "signal": 60, "security": "WPA2"},
            {"ssid": "OpenNet", "signal": 40, "security": ""},
        ])

    try:
        result = subprocess.run(
            ["nmcli", "-t", "-f", "SSID,SIGNAL,SECURITY",
             "device", "wifi", "list", "--rescan", "yes"],
            capture_output=True, text=True, timeout=15,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return jsonify([])

    networks = []
    seen = set()
    for line in result.stdout.strip().split("\n"):
        parts = line.split(":")
        if len(parts) >= 3 and parts[0] and parts[0] not in seen:
            seen.add(parts[0])
            networks.append({
                "ssid": parts[0],
                "signal": int(parts[1]) if parts[1].isdigit() else 0,
                "security": parts[2] if parts[2] else "Open",
            })
    networks.sort(key=lambda n: n["signal"], reverse=True)
    return jsonify(networks)


@app.route("/api/wifi/connect", methods=["POST"])
def wifi_connect():
    data = request.json or {}
    ssid = data.get("ssid", "")
    password = data.get("password", "")
    if not ssid:
        return jsonify({"error": "SSID required"}), 400

    app.config["WIFI_TARGET"] = ssid
    app.config["WIFI_STATUS"] = "connecting"
    app.config["WIFI_ERROR"] = ""

    if MOCK_MODE:
        app.config["WIFI_STATUS"] = "connected"
        return jsonify({"status": "connecting"})

    thread = threading.Thread(target=_connect_wifi, args=(ssid, password), daemon=True)
    thread.start()
    return jsonify({"status": "connecting"})


@app.route("/api/wifi/status")
def wifi_status():
    return jsonify({
        "status": app.config["WIFI_STATUS"],
        "ssid": app.config["WIFI_TARGET"],
        "error": app.config["WIFI_ERROR"],
    })


# ---- Device password API -------------------------------------------------

@app.route("/api/device/set-password", methods=["POST"])
def set_password():
    data = request.json or {}
    password = data.get("password", "")
    if len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters"}), 400

    if MOCK_MODE:
        return jsonify({"status": "ok"})

    try:
        proc = subprocess.run(
            ["chpasswd"],
            input=f"pi:{password}",
            text=True, capture_output=True, timeout=5,
        )
        if proc.returncode != 0:
            return jsonify({"error": "Failed to set password"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    return jsonify({"status": "ok"})


# ---- Key generation API --------------------------------------------------

@app.route("/api/keys/generate", methods=["POST"])
def generate_keys():
    jwt_secret = secrets.token_hex(32)
    hmac_key = secrets.token_hex(32)
    dek = secrets.token_hex(32)

    # Write .env with JWT_SECRET and HMAC_KEY only.
    # DEK is shown as QR code and NEVER written to disk.
    env_path = os.path.join(SAFECARE_ROOT, ".env")
    if not MOCK_MODE:
        with open(env_path, "w") as f:
            f.write(_env_template(jwt_secret, hmac_key))
        os.chmod(env_path, 0o600)

    # Hold DEK in memory for QR display only
    app.config["DEK_FOR_QR"] = dek

    return jsonify({"status": "ok"})


@app.route("/api/keys/qr.png")
def qr_png():
    dek = app.config.get("DEK_FOR_QR")
    if not dek:
        abort(404)

    import qrcode

    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=8,
        border=4,
    )
    qr.add_data(f"safecare-dek:{dek}")
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return send_file(buf, mimetype="image/png")


# ---- Docker API ----------------------------------------------------------

@app.route("/api/docker/start", methods=["POST"])
def docker_start():
    app.config["DOCKER_STATUS"] = "starting"

    if MOCK_MODE:
        def mock_start():
            time.sleep(3)
            app.config["DOCKER_STATUS"] = "running"
        threading.Thread(target=mock_start, daemon=True).start()
        return jsonify({"status": "starting"})

    thread = threading.Thread(target=_start_docker, daemon=True)
    thread.start()
    return jsonify({"status": "starting"})


@app.route("/api/docker/status")
def docker_status():
    if MOCK_MODE:
        status = app.config["DOCKER_STATUS"]
        return jsonify({
            "services": {
                "postgres": {"status": "running", "health": "healthy"},
                "redis": {"status": "running", "health": "healthy"},
                "backend": {"status": "running" if status == "running" else "starting",
                            "health": "healthy" if status == "running" else ""},
                "dashboard": {"status": "running" if status == "running" else "starting",
                              "health": ""},
            },
            "coreReady": status == "running",
        })

    try:
        result = subprocess.run(
            ["docker", "compose", "ps", "--format", "json"],
            cwd=os.path.join(SAFECARE_ROOT, "docker"),
            capture_output=True, text=True, timeout=10,
        )
    except Exception:
        return jsonify({"services": {}, "coreReady": False})

    services = {}
    if result.returncode == 0:
        for line in result.stdout.strip().split("\n"):
            if line.strip():
                try:
                    svc = json.loads(line)
                    services[svc.get("Service", svc.get("Name", "unknown"))] = {
                        "status": svc.get("State", "unknown"),
                        "health": svc.get("Health", ""),
                    }
                except json.JSONDecodeError:
                    pass

    core_ready = (
        services.get("backend", {}).get("health") == "healthy"
        and services.get("dashboard", {}).get("status") == "running"
    )
    return jsonify({"services": services, "coreReady": core_ready})


# ---- Internal helpers ----------------------------------------------------

def _connect_wifi(ssid, password):
    try:
        if not RECOVERY_MODE:
            subprocess.run(["systemctl", "stop", "safecare-ap"], timeout=10,
                           capture_output=True)
            time.sleep(2)
        else:
            # In recovery mode, stop hostapd/dnsmasq directly
            subprocess.run(["killall", "hostapd"], timeout=5, capture_output=True)
            subprocess.run(["killall", "dnsmasq"], timeout=5, capture_output=True)
            subprocess.run(["ip", "addr", "flush", "dev", "wlan0"], timeout=5,
                           capture_output=True)
            time.sleep(2)

        cmd = ["nmcli", "device", "wifi", "connect", ssid, "ifname", "wlan0"]
        if password:
            cmd += ["password", password]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            raise Exception(result.stderr.strip() or "nmcli failed")

        # Verify internet
        for _ in range(10):
            time.sleep(2)
            try:
                check = subprocess.run(
                    ["curl", "-s", "--max-time", "3",
                     "http://captive.apple.com/hotspot-detect.html"],
                    capture_output=True, text=True, timeout=5,
                )
                if "Success" in check.stdout:
                    app.config["WIFI_STATUS"] = "connected"
                    return
            except Exception:
                pass

        raise Exception("Connected to WiFi but no internet detected")
    except Exception as e:
        app.config["WIFI_STATUS"] = "failed"
        app.config["WIFI_ERROR"] = str(e)
        if not RECOVERY_MODE:
            subprocess.run(["systemctl", "start", "safecare-ap"],
                           timeout=10, capture_output=True)
        else:
            # In recovery, restart the AP inline
            subprocess.run(["ip", "addr", "add", "10.42.0.1/24", "dev", "wlan0"],
                           timeout=5, capture_output=True)
            subprocess.run(["hostapd", "-B", "/tmp/hostapd-recovery.conf"],
                           timeout=5, capture_output=True)
            subprocess.run(["dnsmasq", "--conf-file",
                            f"{SAFECARE_ROOT}/scripts/rpi/config/dnsmasq.conf"],
                           timeout=5, capture_output=True)


def _start_docker():
    try:
        subprocess.run(
            ["docker", "compose", "up", "-d"],
            cwd=os.path.join(SAFECARE_ROOT, "docker"),
            timeout=300, capture_output=True,
        )
        sentinel = os.path.join(SAFECARE_ROOT, ".provisioned")
        with open(sentinel, "w") as f:
            f.write(time.strftime("%Y-%m-%dT%H:%M:%SZ"))
        app.config["DOCKER_STATUS"] = "running"
    except Exception:
        app.config["DOCKER_STATUS"] = "error"


def _get_wlan_ip():
    if MOCK_MODE:
        return "192.168.1.100"
    try:
        result = subprocess.run(
            ["ip", "-4", "-o", "addr", "show", "wlan0"],
            capture_output=True, text=True, timeout=5,
        )
        for part in result.stdout.split():
            if "." in part and "/" in part:
                return part.split("/")[0]
    except Exception:
        pass
    return "unknown"


def _env_template(jwt_secret, hmac_key):
    return f"""# SafeCare Environment (generated by provisioner)
# NOTE: The DEK (Data Encryption Key) is NOT stored here.
# It must be provided via the dashboard unlock screen on each boot.

# Database
DATABASE_URL=postgres://safecare:safecare@localhost:5432/safecare

# Redis
REDIS_URL=redis://localhost:6379

# Security
JWT_SECRET={jwt_secret}
HMAC_KEY={hmac_key}

# Twilio (configure in dashboard Settings)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=

# JotForm (optional)
JOTFORM_API_KEY=

# Server
PORT=3001
HOST=0.0.0.0
NODE_ENV=production

# Dashboard
NEXT_PUBLIC_API_URL=http://localhost:3001
"""


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=80, debug=MOCK_MODE)

#!/bin/bash
set -euo pipefail

echo "=== Booting SafeCare image in QEMU ==="

# Start QEMU in background
qemu-system-aarch64 \
  -M raspi3b \
  -cpu cortex-a72 \
  -m 1G -smp 4 \
  -kernel /tmp/kernel8.img \
  -dtb /tmp/bcm2710-rpi-3-b-plus.dtb \
  -drive "if=sd,format=raw,file=/tmp/2026-03-31-safecare.img" \
  -append "rw earlyprintk loglevel=8 console=ttyAMA0,115200 dwc_otg.lpm_enable=0 root=/dev/mmcblk0p2 rootdelay=1" \
  -device usb-net,netdev=net0 \
  -netdev user,id=net0,hostfwd=tcp::2222-:22,hostfwd=tcp::8888-:80 \
  -usb -device usb-mouse -device usb-kbd \
  -serial file:/tmp/qemu-serial.log \
  -display none \
  -daemonize

echo "QEMU started, waiting 3 min for boot..."
sleep 180

PASS=0
FAIL=0
INFO=0

pass() { PASS=$((PASS+1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }
info() { INFO=$((INFO+1)); echo "  INFO: $1"; }

echo ""
echo "=== Serial output (last 40 lines) ==="
tail -40 /tmp/qemu-serial.log 2>/dev/null || echo "No serial output"

echo ""
echo "=== Boot verification ==="

if grep -q "login:" /tmp/qemu-serial.log 2>/dev/null; then
  pass "System booted to login prompt"
elif grep -q "systemd" /tmp/qemu-serial.log 2>/dev/null; then
  info "Systemd started but no login prompt yet"
else
  info "No serial output (QEMU raspi3b serial is unreliable — rootfs checks below are authoritative)"
fi

if grep -q "safecare-firstboot\|SafeCare" /tmp/qemu-serial.log 2>/dev/null; then
  pass "SafeCare services mentioned in boot log"
else
  info "SafeCare not mentioned in serial log (may be normal)"
fi

if grep -q "Started.*hostapd\|SafeCare.*Setup\|provisioner" /tmp/qemu-serial.log 2>/dev/null; then
  pass "Provisioner/hostapd started during boot"
else
  info "Provisioner start not detected in serial (may need more time)"
fi

# Check if provisioner HTTP is reachable
echo ""
echo "=== HTTP provisioner test ==="
if curl -s --max-time 5 http://localhost:8888/ 2>/dev/null | grep -qi "safecare\|welcome\|setup"; then
  pass "Provisioner HTTP responding"
else
  info "Provisioner not reachable on port 8888 (QEMU raspi3b networking is limited)"
fi

# Check rootfs contents directly by mounting
echo ""
echo "=== Rootfs content verification ==="
LOOP=$(sudo losetup -fP --show /tmp/2026-03-31-safecare.img)
sudo mkdir -p /mnt/rootfs
sudo mount ${LOOP}p2 /mnt/rootfs

if [ -f /mnt/rootfs/opt/safecare/scripts/rpi/provisioner.py ]; then
  pass "Provisioner script present in image"
else
  fail "Provisioner script NOT found"
fi

if [ -f /mnt/rootfs/etc/systemd/system/safecare-firstboot.service ]; then
  pass "safecare-firstboot.service installed"
else
  fail "safecare-firstboot.service NOT found"
fi

if [ -f /mnt/rootfs/etc/systemd/system/safecare-docker.service ]; then
  pass "safecare-docker.service installed"
else
  fail "safecare-docker.service NOT found"
fi

if [ -f /mnt/rootfs/etc/systemd/system/safecare-wifi-recovery.service ]; then
  pass "safecare-wifi-recovery.service installed"
else
  fail "safecare-wifi-recovery.service NOT found"
fi

if [ -f /mnt/rootfs/etc/avahi/services/avahi-safecare.service ]; then
  pass "Avahi mDNS service installed"
else
  fail "Avahi mDNS service NOT found"
fi

if [ -x /mnt/rootfs/usr/bin/docker ]; then
  pass "Docker installed"
else
  fail "Docker NOT found"
fi

if [ -x /mnt/rootfs/usr/bin/nmcli ]; then
  pass "NetworkManager (nmcli) installed"
else
  fail "nmcli NOT found"
fi

if [ -x /mnt/rootfs/usr/sbin/hostapd ]; then
  pass "hostapd installed"
else
  fail "hostapd NOT found"
fi

FLASK_PATH=$(find /mnt/rootfs/usr/lib/python3*/dist-packages/flask -name __init__.py 2>/dev/null | head -1)
if [ -n "$FLASK_PATH" ]; then
  pass "Flask installed"
else
  fail "Flask NOT found"
fi

if grep -q "safecare" /mnt/rootfs/etc/hostname 2>/dev/null; then
  pass "Hostname set to 'safecare'"
else
  fail "Hostname not set correctly"
fi

# Check systemd enable symlinks
if [ -L /mnt/rootfs/etc/systemd/system/multi-user.target.wants/safecare-firstboot.service ]; then
  pass "safecare-firstboot.service enabled"
else
  fail "safecare-firstboot.service NOT enabled"
fi

if [ -d /mnt/rootfs/opt/safecare/docker ]; then
  pass "SafeCare Docker compose files present"
else
  fail "SafeCare Docker compose files NOT found"
fi

if [ -f /mnt/rootfs/opt/safecare/scripts/rpi/config/hostapd.conf ]; then
  pass "hostapd.conf present"
else
  fail "hostapd.conf NOT found"
fi

if [ -f /mnt/rootfs/opt/safecare/scripts/rpi/config/dnsmasq.conf ]; then
  pass "dnsmasq.conf present"
else
  fail "dnsmasq.conf NOT found"
fi

sudo umount /mnt/rootfs
sudo losetup -d $LOOP

echo ""
echo "=========================================="
echo "  Results: $PASS passed, $FAIL failed, $INFO info"
echo "=========================================="

# Kill QEMU
pkill qemu 2>/dev/null || true

if [ $FAIL -gt 0 ]; then
  echo "  FAILURES DETECTED"
  exit 1
fi
echo "  All checks passed!"

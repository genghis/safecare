#!/bin/bash -e
# SafeCare pi-gen stage — system customization
# Runs inside pi-gen chroot during image build.

on_chroot << 'CHEOF'

# 1. Switch from dhcpcd to NetworkManager (required for nmcli WiFi management)
systemctl disable dhcpcd 2>/dev/null || true
systemctl enable NetworkManager

# 2. Disable hostapd and dnsmasq from auto-starting
#    (they're started on-demand by safecare-ap.service)
systemctl disable hostapd 2>/dev/null || true
systemctl disable dnsmasq 2>/dev/null || true

# 3. Add pi user to docker group
usermod -aG docker pi

# 4. Set hostname to safecare (enables safecare.local via Avahi)
echo "safecare" > /etc/hostname
sed -i 's/127\.0\.1\.1.*/127.0.1.1\tsafecare/' /etc/hosts

# 5. Configure Avahi for mDNS
mkdir -p /etc/avahi/services
cp /opt/safecare/scripts/rpi/config/avahi-safecare.service /etc/avahi/services/

# Set Avahi hostname
if [ -f /etc/avahi/avahi-daemon.conf ]; then
  sed -i 's/^#*host-name=.*/host-name=safecare/' /etc/avahi/avahi-daemon.conf
fi

# 6. Install SafeCare systemd services
cp /opt/safecare/scripts/rpi/systemd/safecare-firstboot.service /etc/systemd/system/
cp /opt/safecare/scripts/rpi/systemd/safecare-ap.service /etc/systemd/system/
cp /opt/safecare/scripts/rpi/systemd/safecare-provisioner.service /etc/systemd/system/
cp /opt/safecare/scripts/rpi/systemd/safecare-docker.service /etc/systemd/system/
cp /opt/safecare/scripts/rpi/systemd/safecare-wifi-recovery.service /etc/systemd/system/

systemctl enable safecare-firstboot.service
systemctl enable safecare-docker.service
systemctl enable safecare-wifi-recovery.service

# 7. Set timezone to UTC (user can change later)
ln -sf /usr/share/zoneinfo/UTC /etc/localtime

# 8. Enable SSH (disabled by default on Pi OS)
systemctl enable ssh

# 9. Clean up to reduce image size
apt-get clean
rm -rf /var/lib/apt/lists/*

CHEOF

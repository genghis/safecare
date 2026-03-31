#!/bin/bash -e
# SafeCare pi-gen stage — copy app files and configure system
# NOTE: this script runs from the sub-stage directory (01-safecare-config/)
# so files/ is a relative path.

# Copy SafeCare application into the rootfs
if [ -d "files/opt/safecare" ]; then
	rsync -a "files/opt/safecare/" "${ROOTFS_DIR}/opt/safecare/"
	chmod +x "${ROOTFS_DIR}/opt/safecare/scripts/rpi/provisioner.py" 2>/dev/null || true
	chmod +x "${ROOTFS_DIR}/opt/safecare/scripts/rpi/firstboot.sh" 2>/dev/null || true
	chmod +x "${ROOTFS_DIR}/opt/safecare/scripts/rpi/wifi-recovery.sh" 2>/dev/null || true
fi

# Copy systemd services into rootfs
for svc in safecare-firstboot safecare-ap safecare-provisioner safecare-docker safecare-wifi-recovery; do
	src="${ROOTFS_DIR}/opt/safecare/scripts/rpi/systemd/${svc}.service"
	if [ -f "$src" ]; then
		cp "$src" "${ROOTFS_DIR}/etc/systemd/system/"
	fi
done

# Copy Avahi service definition
mkdir -p "${ROOTFS_DIR}/etc/avahi/services"
if [ -f "${ROOTFS_DIR}/opt/safecare/scripts/rpi/config/avahi-safecare.service" ]; then
	cp "${ROOTFS_DIR}/opt/safecare/scripts/rpi/config/avahi-safecare.service" \
	   "${ROOTFS_DIR}/etc/avahi/services/"
fi

# Configure inside chroot
on_chroot << 'CHEOF'

# Switch from dhcpcd to NetworkManager
systemctl disable dhcpcd 2>/dev/null || true
systemctl enable NetworkManager

# Disable hostapd and dnsmasq from auto-starting
systemctl disable hostapd 2>/dev/null || true
systemctl disable dnsmasq 2>/dev/null || true

# Add pi user to docker group
usermod -aG docker pi

# Set hostname
echo "safecare" > /etc/hostname
sed -i 's/127\.0\.1\.1.*/127.0.1.1\tsafecare/' /etc/hosts

# Set Avahi hostname
if [ -f /etc/avahi/avahi-daemon.conf ]; then
  sed -i 's/^#*host-name=.*/host-name=safecare/' /etc/avahi/avahi-daemon.conf
fi

# Enable SafeCare services
systemctl enable safecare-firstboot.service
systemctl enable safecare-docker.service
systemctl enable safecare-wifi-recovery.service

# Enable SSH
systemctl enable ssh

# Set timezone to UTC
ln -sf /usr/share/zoneinfo/UTC /etc/localtime

# Clean up
apt-get clean
rm -rf /var/lib/apt/lists/*

CHEOF

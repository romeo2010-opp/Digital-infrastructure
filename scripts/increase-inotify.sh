#!/usr/bin/env bash
set -euo pipefail
NEW=524288
echo "Current fs.inotify.max_user_watches: $(cat /proc/sys/fs/inotify/max_user_watches)"
echo "Writing persistent setting to /etc/sysctl.d/99-inotify.conf (requires sudo)"
sudo sh -c "echo fs.inotify.max_user_watches=$NEW > /etc/sysctl.d/99-inotify.conf"
echo "Reloading sysctl settings"
sudo sysctl --system
echo "Applied. New fs.inotify.max_user_watches: $(cat /proc/sys/fs/inotify/max_user_watches)"

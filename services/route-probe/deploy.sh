#!/bin/sh
# Run on the probe host with this directory as the working directory.
set -eu
test "$(id -u)" = 0
test ! -e /opt/pewpew-probe
test ! -e /etc/pewpew-probe
python3 -B -m unittest -v
systemd-analyze verify ./pewpew-probe.service
install -d -m 755 /opt/pewpew-probe/releases/20261028 /etc/pewpew-probe
install -m 644 server.py /opt/pewpew-probe/releases/20261028/server.py
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
  -keyout /etc/pewpew-probe/server.key -out /etc/pewpew-probe/server.crt \
  -days 730 -subj '/CN=PewPew Route Probe' \
  -addext 'subjectAltName=IP:138.68.16.189' \
  -addext 'basicConstraints=critical,CA:TRUE' \
  -addext 'keyUsage=critical,digitalSignature,keyCertSign'
chmod 600 /etc/pewpew-probe/server.key
chmod 644 /etc/pewpew-probe/server.crt
ln -s /opt/pewpew-probe/releases/20261028 /opt/pewpew-probe/current
install -m 644 pewpew-probe.service /etc/systemd/system/pewpew-probe.service
systemctl daemon-reload
systemctl enable --now pewpew-probe.service
ufw allow 18443/tcp comment 'PewPew probe TLS'
ufw allow 18444/udp comment 'PewPew probe receipts'
systemctl is-active pewpew-probe.service
curl --fail --retry 5 --retry-connrefused --retry-delay 1 --cacert /etc/pewpew-probe/server.crt https://138.68.16.189:18443/health

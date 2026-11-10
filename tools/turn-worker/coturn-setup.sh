#!/bin/sh
# コアブレイカーのオンライン試作：定額の VPS に中継サーバー（coturn）を立てる（オーナーの指定 2026-11-09）。
# Ubuntu 22.04 / 24.04 の VPS で、root で1回だけ実行する：  sudo sh coturn-setup.sh
# 最後に出る TURN_HOST と TURN_SECRET を、Cloudflare の Worker（worker.mjs）の「変数とシークレット」に入れる。
# もう一度実行すると秘密を作り直す（Worker の TURN_SECRET も入れ直す）。
set -eu
[ "$(id -u)" = 0 ] || { echo 'root で実行してください（sudo sh coturn-setup.sh）'; exit 1; }
apt-get update -q
DEBIAN_FRONTEND=noninteractive apt-get install -y -q coturn openssl curl
SECRET=$(openssl rand -hex 32)
IP=$(curl -4 -fsS --max-time 10 https://api.ipify.org || hostname -I | awk '{print $1}')
cat > /etc/turnserver.conf <<CONF
# 作った道具：コアブレイカー tools/turn-worker/coturn-setup.sh
listening-port=3478
external-ip=$IP
min-port=49160
max-port=49260
fingerprint
# 合言葉は Worker が共有の秘密から期限つきで作る（TURN REST API 方式）。
use-auth-secret
static-auth-secret=$SECRET
realm=core-breaker
# 使いすぎの歯止め：同時の中継の数、1本あたりと全体の速さ（バイト/秒）。ゲーム1人分はおよそ 40KB/秒。
total-quota=40
max-bps=300000
bps-capacity=3000000
stale-nonce=600
no-tls
no-dtls
no-cli
no-tcp-relay
no-multicast-peers
# 中継を使って VPS の内側やほかの内向きのアドレスへ入られないようにする。
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.0.0.0-192.0.0.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=198.18.0.0-198.19.255.255
denied-peer-ip=224.0.0.0-255.255.255.255
denied-peer-ip=::1
denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff
simple-log
log-file=syslog
CONF
# 秘密が入るので、coturn（turnserver のグループ）だけが読めるようにする。
if chgrp turnserver /etc/turnserver.conf 2>/dev/null; then chmod 640 /etc/turnserver.conf; else chmod 644 /etc/turnserver.conf; fi
[ -f /etc/default/coturn ] && sed -i 's/^#*TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
if command -v ufw >/dev/null 2>&1; then
  ufw allow 22/tcp >/dev/null; ufw allow 3478/udp >/dev/null; ufw allow 3478/tcp >/dev/null; ufw allow 49160:49260/udp >/dev/null
  ufw --force enable >/dev/null
fi
systemctl enable coturn >/dev/null 2>&1 || true
systemctl restart coturn
sleep 1
systemctl is-active --quiet coturn || { echo 'coturn が起動しませんでした。journalctl -u coturn を見てください'; exit 1; }
echo
echo '中継サーバーを起動しました。次の2つを Worker の「変数とシークレット」に入れてください。'
echo "  TURN_HOST   = $IP        （テキスト）"
echo "  TURN_SECRET = $SECRET    （シークレット）"
echo 'VPS の管理画面にファイアウォール（セキュリティグループ）があれば、3478（UDP/TCP）と 49160-49260（UDP）を開けてください。'

ubuntu@ip-172-31-10-226:/etc/nginx/sites-available$ cat 003_mux.bawebtech.com
# -------------------------
# HTTP → HTTPS redirect
# -------------------------
server {
  listen 80;
  server_name mux.bawebtech.com;
  return 301 https://$host$request_uri;
}

# -------------------------
# HTTPS site
# -------------------------
server {
  listen 443 ssl http2;
  server_name mux.bawebtech.com;

  # --- Certbot-managed TLS ---
  ssl_certificate     /etc/letsencrypt/live/mux.bawebtech.com/fullchain.pem; # managed by Certbot
  ssl_certificate_key /etc/letsencrypt/live/mux.bawebtech.com/privkey.pem;   # managed by Certbot
  include             /etc/letsencrypt/options-ssl-nginx.conf;               # managed by Certbot
  ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;                     # managed by Certbot

  # Body size: uploads go direct to Mux, so modest is fine
  client_max_body_size 5m;

  # Common proxy headers
  proxy_set_header Host              $host;
  proxy_set_header X-Real-IP         $remote_addr;
  proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;

  # WebSocket-friendly headers (harmless if unused)
  # proxy_set_header Upgrade $http_upgrade;
  # proxy_set_header Connection $connection_upgrade;

  # -------------------------
  # API → Node on localhost:3200
  # -------------------------
  location /api/ {
    # remove the trailing slash so nginx forwards the full original path
    proxy_pass http://127.0.0.1:3200;
    proxy_http_version 1.1;

    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_read_timeout 300;
    proxy_send_timeout 300;
  }

  # -------------------------
  # SPA build include (swap this symlink to change builds)
  # -------------------------
  # Recommended target on server: /etc/nginx/mux/build.current.conf
  include /etc/nginx/mux/build.current.conf;
}

# Helper map for WebSocket Connection header (place once in http{} context)
# If you don't already have this globally, add the block below to /etc/nginx/nginx.conf inside "http { ... }"
# or save as /etc/nginx/conf.d/upgrade_map.conf
# 
# map $http_upgrade $connection_upgrade {
#   default upgrade;
#   ''      close;
# }
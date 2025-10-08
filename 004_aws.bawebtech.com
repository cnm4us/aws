# -------------------------
# HTTP site (Certbot will add HTTPS + redirect)
# -------------------------
server {
  listen 80;
  server_name aws.bawebtech.com;

  # Increase if you later proxy uploads through Nginx
  client_max_body_size 10m;

  # Allow HTTP-01 challenges
  location ^~ /.well-known/acme-challenge/ {
    root /var/www/certbot;
  }

  # -------------------------
  # API → Node on localhost:3300
  # -------------------------
  location /api/ {
    proxy_pass http://127.0.0.1:3300;
    proxy_http_version 1.1;

    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_read_timeout 300;
    proxy_send_timeout 300;
  }

  # -------------------------
  # App UI (served by Node: static + index)
  # -------------------------
  location / {
    proxy_pass http://127.0.0.1:3300;
    proxy_http_version 1.1;

    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_read_timeout 300;
    proxy_send_timeout 300;
  }
}


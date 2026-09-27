# Nexwall consolidated log viewer - nginx wiring
# Included from /etc/nginx/conf.d/ns-ui.conf (port 9090, same TLS as ns-ui)
location /logs-viewer/api/ {
	proxy_set_header Host $host;
	proxy_pass http://127.0.0.1:9428/;
	proxy_read_timeout 60s;
}

location /logs-viewer/ {
	root /www-ns;
	index index.html;
	try_files $uri $uri/ =404;
}

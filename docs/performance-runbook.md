# Performance runbook (self-hosted)

## 1) Enable `pg_stat_statements` + slow query logging

```bash
sudo -u postgres psql -c "ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements';"
sudo -u postgres psql -c "ALTER SYSTEM SET pg_stat_statements.track = 'all';"
sudo -u postgres psql -c "ALTER SYSTEM SET track_io_timing = 'on';"
sudo -u postgres psql -c "ALTER SYSTEM SET log_min_duration_statement = '200ms';"
sudo systemctl restart postgresql
sudo -u postgres psql -d YOUR_DB_NAME -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"
```

## 2) Apply backend migrations (including hot-path indexes)

```bash
cd /path/to/demo0
psql "$DATABASE_URL" -f backend/migrations/003_soft_delete_posts.sql
psql "$DATABASE_URL" -f backend/migrations/004_hot_path_indexes.sql
```

## 3) Check top slow queries

```bash
sudo -u postgres psql -d YOUR_DB_NAME -c "
SELECT
  calls,
  round(total_exec_time::numeric, 2) AS total_ms,
  round(mean_exec_time::numeric, 2) AS mean_ms,
  rows,
  substr(query, 1, 240) AS query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
"
```

## 4) Caddy compression + cache headers (recommended)

Add/update site block in `/etc/caddy/Caddyfile`:

```caddy
encode zstd gzip

@static {
  path *.js *.css *.png *.jpg *.jpeg *.gif *.webp *.svg *.ico *.woff *.woff2 *.mjs
}
header @static Cache-Control "public, max-age=31536000, immutable"

@html {
  path /
  path *.html
}
header @html Cache-Control "public, max-age=60"
```

Reload Caddy:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

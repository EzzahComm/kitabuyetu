FROM postgres:17-alpine
COPY --chmod=0644 supabase/migrations/*.sql /docker-entrypoint-initdb.d/
COPY --chmod=0644 scripts/docker-init/00-bootstrap-roles.sql /docker-entrypoint-initdb.d/00-bootstrap-roles.sql

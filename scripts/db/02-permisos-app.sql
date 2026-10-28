-- EasyRif · Paso 2: permisos mínimos del rol de aplicación.
-- Ejecutar DESPUÉS de aplicar las migraciones, conectado a "easyrif_dev" como easyrif_migrator:
--
--   psql -v ON_ERROR_STOP=1 -h localhost -p 5433 -U easyrif_migrator -d easyrif_dev -f scripts/db/02-permisos-app.sql
-- o bien: npm run db:permisos (usa DATABASE_URL_MIGRATOR de .env.local)


REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO easyrif_app;

-- Datos de negocio: CRUD sin TRUNCATE, REFERENCES ni TRIGGER.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO easyrif_app;
-- Auditoría histórica: el rol de aplicación solo puede leer e insertar.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM easyrif_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO easyrif_app;
REVOKE ALL ON SCHEMA drizzle FROM easyrif_app;

-- Tablas futuras creadas por el migrador: mismos permisos base.
ALTER DEFAULT PRIVILEGES FOR ROLE easyrif_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO easyrif_app;
ALTER DEFAULT PRIVILEGES FOR ROLE easyrif_migrator IN SCHEMA public
  GRANT USAGE ON SEQUENCES TO easyrif_app;

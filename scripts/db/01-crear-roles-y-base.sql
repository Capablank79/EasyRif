-- EasyRif · Paso 1: roles y base de desarrollo (idempotente, con verificaciones previas).
-- Ejecutar como administrador conectado a la base "postgres":
--
--   psql -h localhost -p 5433 -U postgres -d postgres -v migrator_pw="<contraseña>" -v app_pw="<contraseña>" -f scripts/db/01-crear-roles-y-base.sql
--
-- Garantías:
--  * Se detiene ante cualquier error (ON_ERROR_STOP) y ante cualquier verificación fallida.
--  * Solo crea lo que no existe. Los roles/base existentes NUNCA se modifican (ni su contraseña).
--  * REVOKE/GRANT solo se ejecutan sobre easyrif_dev, y solo si su propietario es easyrif_migrator.
--  * No toca ninguna otra base de datos ni otros roles.
--  * Las contraseñas no se imprimen; se desactiva el registro de sentencias de esta sesión.

\set ON_ERROR_STOP on
\set ECHO none
\set QUIET on

-- 1) Variables obligatorias, definidas y no vacías (sin mostrar su valor).
\if :{?migrator_pw}
\else
  \echo 'ERROR: falta la variable migrator_pw (-v migrator_pw=...). Nada se ejecutó.'
  \quit 3
\endif
\if :{?app_pw}
\else
  \echo 'ERROR: falta la variable app_pw (-v app_pw=...). Nada se ejecutó.'
  \quit 3
\endif
SELECT (length(:'migrator_pw') < 12 OR length(:'app_pw') < 12) AS pw_corta \gset
\if :pw_corta
  \echo 'ERROR: las contraseñas deben tener al menos 12 caracteres. Nada se ejecutó.'
  \quit 3
\endif

-- Evita que el servidor registre las sentencias con contraseña (solo esta sesión).
SET log_statement = 'none';
SET log_min_error_statement = 'panic';

-- 2) Comprobaciones previas: no se modifica nada.
DO $$
DECLARE r record;
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Conéctese a la base postgres (conectado a %)', current_database();
  END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'El usuario actual debe ser administrador (superusuario)';
  END IF;

  FOR r IN SELECT * FROM pg_roles WHERE rolname IN ('easyrif_migrator', 'easyrif_app') LOOP
    IF NOT r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole
       OR r.rolbypassrls OR r.rolreplication THEN
      RAISE EXCEPTION 'El rol existente % tiene atributos distintos a los esperados (LOGIN sin SUPERUSER/CREATEDB/CREATEROLE/BYPASSRLS/REPLICATION). No se modificó nada; revíselo manualmente.', r.rolname;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_database WHERE datname = 'easyrif_dev')
     AND (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = 'easyrif_dev') <> 'easyrif_migrator' THEN
    RAISE EXCEPTION 'La base easyrif_dev existe pero su propietario no es easyrif_migrator. No se modificó nada.';
  END IF;
END $$;

-- 3) Creación solo de lo que falta.
SELECT format('CREATE ROLE easyrif_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION PASSWORD %L', :'migrator_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'easyrif_migrator') \gexec

SELECT format('CREATE ROLE easyrif_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION PASSWORD %L', :'app_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'easyrif_app') \gexec

SELECT 'CREATE DATABASE easyrif_dev OWNER easyrif_migrator ENCODING ''UTF8'' TEMPLATE template0'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'easyrif_dev') \gexec

-- 4) Verificación final de propiedad ANTES de cualquier REVOKE/GRANT.
DO $$
BEGIN
  IF (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = 'easyrif_dev') IS DISTINCT FROM 'easyrif_migrator' THEN
    RAISE EXCEPTION 'easyrif_dev no pertenece a easyrif_migrator. No se modificaron permisos.';
  END IF;
END $$;

-- 5) Aislamiento: solo easyrif_migrator y easyrif_app (y superusuarios) se conectan a esta base.
REVOKE ALL ON DATABASE easyrif_dev FROM PUBLIC;
GRANT CONNECT ON DATABASE easyrif_dev TO easyrif_migrator, easyrif_app;

-- 6) Resumen sin secretos.
\set QUIET off
SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls
FROM pg_roles WHERE rolname IN ('easyrif_migrator', 'easyrif_app') ORDER BY 1;
SELECT datname, pg_get_userbyid(datdba) AS propietario FROM pg_database WHERE datname = 'easyrif_dev';

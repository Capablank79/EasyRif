# Modelo de datos y seguridad (BUILD-003)

PostgreSQL independiente + Drizzle ORM. Esquema en `src/platform/db/schema/`; migraciones versionadas en `drizzle/`
(`0000_schema_inicial.sql` generada; `0001_triggers_integridad.sql` escrita a mano).

## Tablas (20)

| Grupo | Tablas |
|---|---|
| Identidad | `users` (UUID propio, email normalizado, sin contraseñas; `email_verified`, `image` para Better Auth), `auth_accounts` (hash Argon2id), `auth_sessions`, `auth_verifications`, `platform_admins`, `organizations` (`individual`/`school`), `organization_members` (`owner/admin/editor/viewer`, único por org+usuario) |
| Campañas | `raffles` (slug global único), `prizes`, `digital_products`, `raffle_numbers` (único `(raffle_id, number)`, texto `^[A-Z0-9]{1,12}$`), `numbered_product_units` (producto ↔ número, misma campaña), `sellers` (solo `token_hash` SHA-256) |
| Ventas futuras | `buyer_contacts`, `orders` (sin estado de pago; `is_demo`), `order_items` |
| Sorteos / auditoría | `drawings`, `winners` (solo estructura), `audit_events` (append-only) |

Pendientes conceptuales (no creadas): sesiones/cuentas de autenticación, `schools`, `courses`, `students`, `import_batches`.

## Relaciones y aislamiento

- Todas las tablas hijas llevan `organization_id` y claves foráneas compuestas (`raffle_id, organization_id`) que impiden
  relacionar filas de organizaciones distintas. Los ítems, unidades y ganadores se enlazan por `(id, raffle_id)`.
- Borrados: `RESTRICT` salvo hijos de una campaña/pedido (`CASCADE` en premios, productos, números, unidades, ítems).
- Un número solo puede estar retenido por un pedido activo: `order_items.holds_number` (trigger, `pending`/`confirmed`) + índice único parcial.
- Triggers: `updated_at`, `organization_id` inmutable, mínimo un propietario activo, canje definitivo, `audit_events` append-only.

## Autorización (obligatoria en servidor)

- Cada servicio valida identidad **y** membresía activa en la organización (`src/modules/organizations/membership.ts`,
  `permissions.ts`): denegar por defecto; toda consulta se acota por `organization_id`.
- Autenticado ≠ miembro. El superadministrador interno (`platform_admins`) es independiente de los roles organizacionales.
- Las campañas públicas deben exponer una proyección explícita y mínima.
- **RLS no está activada**: no se ha configurado ni probado contexto de sesión por transacción con un rol SQL sin bypass.
  Queda como defensa en profundidad pendiente; hoy la única barrera de aislamiento entre organizaciones es el código de servidor
  más las claves compuestas.
- `DATABASE_URL` solo en servidor (`src/platform/db/client.ts` importa `server-only`).

## Amenazas consideradas

Filtración entre organizaciones (claves compuestas + autorización), escalamiento de privilegios (matriz de permisos, último propietario),
suplantación de vendedor (solo hash de token), pedidos duplicados (índice parcial), manipulación de `sold` (solo vía servicio),
datos de menores (extensión escolar no implementada), auditoría alterable (append-only; un rol con privilegios de DDL aún podría
deshabilitar triggers: usar un rol de aplicación sin ese privilegio).

## Rifas (BUILD-005, migración 0004)

Trigger `raffles_guard_publication` (BEFORE UPDATE en `raffles`, 30 triggers en total): tras salir de `draft` son inmutables `slug`, `number_count`, `price_cents` y `currency`, y no se vuelve a `draft`; `draft → published` exige precio > 0, al menos un premio y exactamente `number_count` filas en `raffle_numbers`. Es defensa en profundidad: las reglas también se validan en `modules/raffles/service.ts`. `organizations → raffles` es RESTRICT: al limpiar datos de prueba se borran antes las rifas.

## Reservas de demostración e imágenes (BUILD-006, migraciones 0005 y 0006)

Sin tablas ni triggers nuevos (se mantienen 19 tablas y 30 triggers). Se reutiliza `orders`:

- `raffles.image_key` y `prizes.image_key` (uuid opaco; el archivo vive en el almacenamiento, no en la BD).
- `orders.access_token_hash` (SHA-256 del token HMAC de acceso a la reserva), `orders.request_key_hash` (idempotencia; único por `(raffle_id, request_key_hash)`) y `orders.expires_at`.
- Check `orders_demo_never_confirmed`: un pedido con `is_demo` nunca puede estar `confirmed`. Check `orders_demo_has_expiry` (relajado en 0006): un pedido pendiente con token requiere `expires_at`.
- Una reserva demo es un pedido `pending` + `is_demo`; sus números pasan a `reserved` (`reservation_id` = id del pedido, `reserved_until`) y nunca a `sold`. La doble retención sigue bloqueada por `holds_number` y el índice único parcial.
- Concurrencia: `FOR SHARE` sobre la rifa y `FOR UPDATE` de los números en orden. La caducidad es perezosa: una reserva vencida cuenta como disponible y se libera en la siguiente transacción.
- Limitaciones: el almacenamiento local (`.storage/`) no sirve en hosting serverless; el rate limit es en memoria por instancia.


## Comprobante PDF y verificación (BUILD-007, migración 0007)

Sin tablas nuevas (19 tablas, **31 triggers**). Cambios sobre `orders`:

- `orders.verification_hash` (SHA-256 del código de verificación del QR; índice único `orders_verification_uq`) y `orders.receipt_issued_at` (se fija una sola vez en la primera emisión).
- El código de verificación es `HMAC-SHA256(BETTER_AUTH_SECRET, "verificar:" + order_id)`: determinista (el QR es idéntico en cada descarga), no se guarda en claro y es independiente del token de acceso/liberación de la reserva. Conocer el código solo permite consultar el estado, nunca liberar ni leer datos del comprador.
- Trigger `raffle_numbers_no_demo_sold` (BEFORE INSERT OR UPDATE en `raffle_numbers`): impide `status = 'sold'` para un número que pertenece a un `order_item` de un pedido `is_demo`. Se suma al check `orders_demo_never_confirmed`.
- Un pedido = un comprobante con todos sus números (`order_items` conserva los números aunque la reserva se libere o venza). Tope de 200 números por PDF.
- V0.7.1: sin cambios de esquema. Descargas repetidas del PDF son idempotentes (`receipt_issued_at` se fija una sola vez; no se crean pedidos ni `order_items`). La URL del QR se valida (`resolvePublicBaseUrl`); en producción no se admite localhost.
- Limitaciones: el PDF es una copia puntual (no se actualiza; el estado vigente se consulta por el QR); el nombre de la organización aparece en el PDF; `NEXT_PUBLIC_APP_URL` debe apuntar a la URL pública para que el QR sea válido fuera de local.

## Talonarios foliados (BUILD-008, migración 0008)

- Tabla nueva `booklets` (20 tablas en total): `raffle_id`, `organization_id`, `folio` (único por rifa). `raffles` añade `numbering_mode` (`individual` por defecto | `booklets`), `booklet_count`, `numbers_per_booklet`, `first_folio`; `raffle_numbers` añade `booklet_id` y `local_number` (NULL en rifas individuales).
- La clave en `raffle_numbers.number` es `T<folio>N<local>` con anchos fijos (ej. `T0007N14`); se muestra como `T-0007 / N-14`. Conserva `UNIQUE(raffle_id, number)`. `raffles.number_count` es el total de participaciones (10×20 = 200).
- Triggers nuevos (35 en total): `booklets_org_immutable`, `booklets_guard`, `raffle_numbers_booklet_guard` (clave coherente con folio y número interno) y `raffles_guard_numbering` (la numeración es inmutable fuera de borrador o con números generados; al publicar exige todos los talonarios).
- La generación es idempotente y concurrente (`ON CONFLICT DO NOTHING`). Límites configurables: `RAFFLE_MAX_BOOKLETS` (500, tope 2000) y `RAFFLE_MAX_NUMBERS_PER_BOOKLET` (200, tope 9999).
- Compatibilidad: las rifas existentes (MIGUELITO, martin) permanecen en modo `individual` sin cambios.
- Pendiente de decisión (no implementado): equidad del futuro sorteo (uniforme por folio o ponderado por participación). Las reservas demo no serán elegibles.
- Limitaciones: no hay bloqueo explícito del borrado de talonarios con números reservados (cascade desde la rifa); rate limit en memoria.

## Talonarios colaborativos (BUILD-008 V0.8.1, migración 0009)

- Tablas nuevas (22 en total): `booklet_assignments` (historial append-only de responsable por talonario; una fila vigente = `ended_at IS NULL`; reasignar cierra la fila y abre otra) y `order_item_participants` (un participante por participación en pedidos demo: nombre, correo, teléfono opcional; inmutable). `sellers` ya existía (token opaco: solo se guarda su SHA-256; `orders.seller_id` conserva la atribución histórica).
- `raffles` añade `sales_closes_at` y `draw_at` (CHECK: el sorteo es posterior al cierre). Se guardan en UTC y se muestran en `APP_TIMEZONE` (por defecto `America/Santiago`).
- Triggers nuevos (41 en total): `order_items_require_participant` (diferido: cada participación de un talonario exige participante), `orders_sales_open` (no hay pedidos tras el cierre), `raffles_guard_dates` (publicar exige ambas fechas y cierre futuro; el cierre solo se extiende ya publicada), `booklet_assignments_guard`, `participants_guard`, `booklet_assignments_org_immutable`.
- Enlace del responsable `/v/<token>`: el token se deriva con HMAC-SHA256 de `BETTER_AUTH_SECRET` y el id del responsable (el propietario/administrador puede volver a copiarlo). **Rotar `BETTER_AUTH_SECRET` invalida todos los enlaces.** El enlace restringe la selección a los talonarios asignados y atribuye el pedido; la ficha pública general `/r/<slug>` sigue mostrando todos los talonarios (pedidos sin responsable).
- Datos personales: solo en el PDF privado (acceso por token) y base de datos; nunca en el QR, la verificación pública, URLs ni registros de auditoría (la auditoría redacta claves sensibles). Retención y consentimiento definitivos: solo diseñados.
- Estado de campaña calculado siempre desde la BD. En demostración no hay ventas: ningún talonario puede quedar «completo» y el sorteo permanece bloqueado.
- Extender el cierre requiere el permiso `raffle:close` y queda auditado (`raffle.sales_extended`).
- Limitaciones: la reserva con participantes admite hasta 50 por solicitud (`MAX_PARTICIPANTS_PAYLOAD`); borrar una rifa con responsables está restringido por clave foránea; equidad del sorteo (uniforme por folio o ponderado) y recordatorios/reportes siguen sin decidir/implementar.

## Simulación de sorteos (BUILD-009, migración 0010)

- Tablas nuevas (24 en total): `simulation_runs` (una ejecución: fuente `raffle_config` o `synthetic`, versión de reglas, clave de idempotencia única por rifa, instantánea jsonb, `snapshot_hash` y `result_hash` sha256, `is_simulation` con CHECK `= true`) y `simulation_draws` (una fila por premio: folio, número, elegibles antes, peso del folio, folios en juego y pesos previos; únicas `(run, premio)` y `(run, folio, número)`). FK compuesta `(raffle_id, organization_id)` con cascade.
- Triggers nuevos (43 en total): `simulation_runs_no_update` y `simulation_draws_no_update` (inmutables; DELETE solo por cascada al borrar la rifa).
- Separadas a propósito de `drawings` y `winners`, reservadas al sorteo oficial: la simulación nunca las escribe ni lee ventas, pedidos o reservas.
- Algoritmo: peso del folio = participaciones elegibles restantes; número uniforme dentro del folio; la participación ganadora se excluye, el folio sigue; una persona puede ganar varios premios con números distintos. Equidad: 1/N por participación.
- Límites: 50 premios, 1000 talonarios, 9999 números por talonario, 200 ejecuciones por rifa, 100.000 participaciones sintéticas.
- Limitaciones: el modo individual solo se simula con datos sintéticos; los digests no prueban aleatoriedad; el sorteo oficial permanece bloqueado.

`npm test`: invariantes y migraciones sobre PGlite (PostgreSQL embebido). Además se ejecutan contra PostgreSQL 18.6 real (`tests/pg/*`, ver README): restricciones, permisos del rol de aplicación, concurrencia y autenticación.

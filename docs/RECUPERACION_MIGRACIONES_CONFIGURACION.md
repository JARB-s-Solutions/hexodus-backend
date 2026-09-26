# Recuperación de migraciones de `configuracion_sistema`

## Problema corregido

El esquema Prisma contiene el modelo `ConfiguracionSistema`, pero el historial
versionado no contenía la migración que crea `configuracion_sistema`. La
migración `20260621000000_add_mostrar_rfc_en_ticket` intentaba alterar esa tabla
y fallaba al construir una base desde cero.

La migración `20260311000000_create_configuracion_sistema` restaura el paso
faltante. Está ordenada antes de la migración del RFC y usa operaciones
idempotentes para conservar una tabla y sus datos si ya existen.

## Despliegue seguro en producción

No ejecutar `prisma migrate reset`, `prisma db push` ni borrar registros de
`_prisma_migrations` manualmente.

Desarrollo y producción son dos proyectos Supabase independientes. La
migración debe probarse y quedar registrada primero en desarrollo. Después se
debe transferir el mismo directorio de migración, sin cambiar su nombre ni su
contenido, al repositorio que despliega producción. Nunca se debe copiar la
tabla `_prisma_migrations` de una base a otra.

1. Crear un backup verificable de la base de producción.
2. Configurar `DIRECT_URL` con la conexión directa válida de Supabase.
3. Inspeccionar el estado sin modificar la base:

   ```bash
   pnpm exec prisma migrate status --schema prisma/schema.prisma
   ```

4. Si `20260621000000_add_mostrar_rfc_en_ticket` aparece como fallida, marcar
   únicamente ese intento como revertido:

   ```bash
   pnpm exec prisma migrate resolve \
     --rolled-back 20260621000000_add_mostrar_rfc_en_ticket \
     --schema prisma/schema.prisma
   ```

   Este comando solo corrige el registro fallido del historial; no elimina una
   tabla ni revierte datos.

5. Aplicar las migraciones pendientes:

   ```bash
   pnpm exec prisma migrate deploy --schema prisma/schema.prisma
   ```

6. Verificar nuevamente:

   ```bash
   pnpm exec prisma migrate status --schema prisma/schema.prisma
   ```

## Resultado esperado

Las migraciones siguientes deben figurar como aplicadas y no debe existir una
migración fallida:

- `20260311000000_create_configuracion_sistema`
- `20260621000000_add_mostrar_rfc_en_ticket`

La tabla debe conservar su registro singleton y contener la columna
`mostrar_rfc_en_ticket` con valor predeterminado `true`.

## Consulta de comprobación

Ejecutar como lectura en el SQL Editor de Supabase:

```sql
select
  to_regclass('public.configuracion_sistema') as tabla,
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'configuracion_sistema'
      and column_name = 'mostrar_rfc_en_ticket'
  ) as tiene_columna_rfc,
  (select count(*) from public.configuracion_sistema) as registros;
```

El resultado esperado es `configuracion_sistema`, `true` y normalmente un solo
registro. La consulta no modifica datos.

## Módulo `sociosApp`

Los modelos `SocioAppAccount`, `SocioAppOtp`, `SocioAppSession` y
`SocioAppAuthEvent` se crean mediante la migración posterior e independiente
`20260907000000_add_socios_app_auth`. El esquema y los repositorios que usan
estas tablas ya están presentes en el backend; esta entrega incorpora el SQL
faltante, sin cambiar los endpoints ni el flujo de autenticación.

`prisma migrate deploy` aplica todas las migraciones pendientes, incluida la
de `sociosApp`. Antes de ejecutarlo, comprobar en desarrollo el flujo de OTP,
creación y revocación de sesiones, y consulta del perfil; confirmar también la
configuración de correo y `JWT_SECRET` del entorno de destino.

La migración de `sociosApp` no es idempotente. Si alguna tabla `socio_app_*` ya
existe sin su registro de migración, detener el despliegue y reconciliar el
esquema y el historial antes de continuar. No marcarla como aplicada sin
verificar todas sus tablas, columnas, índices y claves foráneas.

Después del despliegue, comprobar que
`20260907000000_add_socios_app_auth` también figura como aplicada. Las tablas
nuevas no cargan cuentas ni sesiones iniciales; el backend las crea durante
el uso de la aplicación. La migración de configuración tampoco inserta un
registro singleton en una base vacía: conserva el existente cuando lo hay.

## Alcance de la validación de esta entrega

Se ejecutaron las 12 pruebas unitarias existentes de fechas y vigencia de
membresías, la instalación con `npm ci` (incluida la generación del cliente
Prisma) y `prisma validate` con URLs locales de ejemplo, sin conexión a una
base de datos. Estas comprobaciones no sustituyen las pruebas de migración
y autenticación en desarrollo. No se aplicaron migraciones ni se modificó
la base de producción al preparar el pull request.

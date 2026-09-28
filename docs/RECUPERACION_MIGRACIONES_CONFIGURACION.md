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
`SocioAppAuthEvent` pertenecen a una evolución distinta. Sus tablas deben
crearse en una migración posterior e independiente. No deben incorporarse a la
migración de configuración ni desplegarse en producción hasta que el backend
de la aplicación de socios esté listo para publicarse.

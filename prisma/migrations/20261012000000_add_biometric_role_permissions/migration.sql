-- El motor biométrico V2 separa el permiso operativo de asistencia del acceso
-- a la caché de huellas. Incorporamos el módulo sin reemplazar permisos
-- personalizados que ya pudieran existir.
--
-- Los roles que actualmente pueden registrar asistencias reciben únicamente
-- sincronización. El enrolamiento permanece restringido y debe concederse de
-- forma explícita desde Gestión de Roles. Los administradores conservan acceso
-- total por su bandera, pero se completa también su JSON para consistencia.
UPDATE "roles"
SET "permisos" = jsonb_set(
  COALESCE("permisos", '{}'::jsonb),
  '{biometria}',
  jsonb_build_object(
    'sincronizar', CASE
      WHEN "es_administrador" THEN true
      ELSE COALESCE(("permisos" #>> '{asistencia,crear}')::boolean, false)
    END,
    'enrolar', "es_administrador"
  ) || COALESCE("permisos"->'biometria', '{}'::jsonb),
  true
)
WHERE NOT COALESCE("permisos", '{}'::jsonb) ? 'biometria'
   OR NOT COALESCE("permisos"->'biometria', '{}'::jsonb) ? 'sincronizar'
   OR NOT COALESCE("permisos"->'biometria', '{}'::jsonb) ? 'enrolar';

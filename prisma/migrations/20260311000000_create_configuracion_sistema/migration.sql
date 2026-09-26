-- Esta tabla ya existe en producción, pero su migración original no quedó
-- versionada. La migración es deliberadamente idempotente para poder marcar el
-- estado real sin recrear ni sobrescribir la configuración existente.
CREATE TABLE IF NOT EXISTS "configuracion_sistema" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "color_principal" VARCHAR(7) NOT NULL,
    "color_secundario" VARCHAR(7) NOT NULL,
    "modo_tema" VARCHAR(10) NOT NULL,
    "nombre_sistema" VARCHAR(80) NOT NULL,
    "logo_sistema" TEXT,
    "gimnasio_nombre" VARCHAR(120) NOT NULL,
    "gimnasio_domicilio" VARCHAR(255) NOT NULL,
    "gimnasio_telefono" VARCHAR(30) NOT NULL,
    "gimnasio_rfc" VARCHAR(13) NOT NULL,
    -- Se incluye también en el CREATE para cubrir bases cuyo historial tenga
    -- la migración posterior marcada como aplicada. Esa migración usa
    -- IF NOT EXISTS, por lo que sigue siendo segura en una instalación nueva.
    "mostrar_rfc_en_ticket" BOOLEAN NOT NULL DEFAULT true,
    "gimnasio_logo" TEXT,
    "ticket_footer" VARCHAR(100) NOT NULL,
    "ticket_mensaje_agradecimiento" VARCHAR(200) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,

    CONSTRAINT "configuracion_sistema_pkey" PRIMARY KEY ("id")
);

-- PostgreSQL no soporta ADD CONSTRAINT IF NOT EXISTS. Este bloque evita
-- duplicar la FK cuando la tabla proviene del esquema que ya está en uso.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'configuracion_sistema_updated_by_fkey'
          AND conrelid = '"configuracion_sistema"'::regclass
    ) THEN
        ALTER TABLE "configuracion_sistema"
        ADD CONSTRAINT "configuracion_sistema_updated_by_fkey"
        FOREIGN KEY ("updated_by") REFERENCES "usuarios"("usuario_id")
        ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

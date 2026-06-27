ALTER TABLE "configuracion_sistema"
ADD COLUMN IF NOT EXISTS "mostrar_rfc_en_ticket" BOOLEAN NOT NULL DEFAULT true;

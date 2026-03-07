-- CreateEnum
CREATE TYPE "AccesoMetodo" AS ENUM ('facial', 'huella', 'tarjeta', 'manual');

-- AlterTable
ALTER TABLE "accesos" ADD COLUMN     "confidence" DECIMAL(5,2),
ADD COLUMN     "match_distance" DECIMAL(5,3),
ADD COLUMN     "metodo" "AccesoMetodo" NOT NULL DEFAULT 'facial';

-- CreateTable
CREATE TABLE "intentos_acceso_fallidos" (
    "intento_id" SERIAL NOT NULL,
    "fecha_hora" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "face_descriptor" JSONB,
    "imagen_captura" TEXT,
    "match_distance_minimo" DECIMAL(5,3),
    "dispositivo_id" VARCHAR(60),
    "ip_address" VARCHAR(45),

    CONSTRAINT "intentos_acceso_fallidos_pkey" PRIMARY KEY ("intento_id")
);

-- CreateIndex
CREATE INDEX "intentos_acceso_fallidos_fecha_hora_idx" ON "intentos_acceso_fallidos"("fecha_hora" DESC);

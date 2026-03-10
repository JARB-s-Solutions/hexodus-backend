-- CreateEnum
CREATE TYPE "AlertaTipo" AS ENUM ('vencimiento_membresia', 'stock_bajo', 'inactividad_socio', 'pago_pendiente');

-- CreateEnum
CREATE TYPE "AlertaEstado" AS ENUM ('activa', 'vista', 'resuelta', 'descartada');

-- CreateEnum
CREATE TYPE "AlertaPrioridad" AS ENUM ('baja', 'media', 'alta', 'urgente');

-- CreateTable
CREATE TABLE "alertas_sistema" (
    "id" TEXT NOT NULL,
    "tipo" "AlertaTipo" NOT NULL,
    "estado" "AlertaEstado" NOT NULL DEFAULT 'activa',
    "prioridad" "AlertaPrioridad" NOT NULL DEFAULT 'media',
    "titulo" VARCHAR(255) NOT NULL,
    "descripcion" TEXT,
    "socio_id" INTEGER,
    "producto_id" INTEGER,
    "membresia_socio_id" INTEGER,
    "datos_adicionales" JSONB,
    "vista_por_id" INTEGER,
    "fecha_vista" TIMESTAMP(3),
    "resuelta_por_id" INTEGER,
    "fecha_resolucion" TIMESTAMP(3),
    "notas_resolucion" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alertas_sistema_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracion_alertas" (
    "id" TEXT NOT NULL,
    "alerta_vencimientos_activa" BOOLEAN NOT NULL DEFAULT true,
    "alerta_vencimientos_dias" INTEGER NOT NULL DEFAULT 7,
    "alerta_stock_activa" BOOLEAN NOT NULL DEFAULT true,
    "alerta_stock_minimo" INTEGER NOT NULL DEFAULT 10,
    "alerta_inactividad_activa" BOOLEAN NOT NULL DEFAULT true,
    "alerta_inactividad_dias" INTEGER NOT NULL DEFAULT 15,
    "alerta_pagos_activa" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "configuracion_alertas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "alertas_sistema_estado_idx" ON "alertas_sistema"("estado");

-- CreateIndex
CREATE INDEX "alertas_sistema_tipo_idx" ON "alertas_sistema"("tipo");

-- AddForeignKey
ALTER TABLE "alertas_sistema" ADD CONSTRAINT "alertas_sistema_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("socio_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alertas_sistema" ADD CONSTRAINT "alertas_sistema_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("producto_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alertas_sistema" ADD CONSTRAINT "alertas_sistema_membresia_socio_id_fkey" FOREIGN KEY ("membresia_socio_id") REFERENCES "membresia_socio"("membresia_socio_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alertas_sistema" ADD CONSTRAINT "alertas_sistema_vista_por_id_fkey" FOREIGN KEY ("vista_por_id") REFERENCES "usuarios"("usuario_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alertas_sistema" ADD CONSTRAINT "alertas_sistema_resuelta_por_id_fkey" FOREIGN KEY ("resuelta_por_id") REFERENCES "usuarios"("usuario_id") ON DELETE SET NULL ON UPDATE CASCADE;

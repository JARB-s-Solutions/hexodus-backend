/*
  Warnings:

  - The `status` column on the `usuarios` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "EstadoGeneral" AS ENUM ('activo', 'inactivo');

-- CreateEnum
CREATE TYPE "ContratoStatus" AS ENUM ('vigente', 'vencido', 'cancelado');

-- CreateEnum
CREATE TYPE "MembresiaSocioStatus" AS ENUM ('activa', 'vencida', 'cancelada');

-- CreateEnum
CREATE TYPE "EstadoPago" AS ENUM ('sin_pagar', 'pagado');

-- CreateEnum
CREATE TYPE "MovimientoInvTipo" AS ENUM ('IN', 'OUT', 'AJUSTE');

-- CreateEnum
CREATE TYPE "ReferenciaInvTipo" AS ENUM ('compra', 'venta', 'ajuste', 'otro');

-- CreateEnum
CREATE TYPE "CompraStatus" AS ENUM ('registrada', 'cancelada');

-- CreateEnum
CREATE TYPE "VentaStatus" AS ENUM ('exitosa', 'cancelada', 'pendiente');

-- CreateEnum
CREATE TYPE "BackupTipo" AS ENUM ('full', 'incremental', 'manual');

-- CreateEnum
CREATE TYPE "ProcesoStatus" AS ENUM ('exitoso', 'fallido');

-- CreateEnum
CREATE TYPE "CorteCajaStatus" AS ENUM ('abierto', 'cerrado');

-- CreateEnum
CREATE TYPE "AccesoTipo" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "ConceptoTipo" AS ENUM ('ingreso', 'gasto');

-- CreateEnum
CREATE TYPE "CajaRefTipo" AS ENUM ('venta', 'membresia', 'otro');

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "password_reset_expires" TIMESTAMP(3),
ADD COLUMN     "password_reset_token" VARCHAR(255),
DROP COLUMN "status",
ADD COLUMN     "status" "EstadoGeneral" NOT NULL DEFAULT 'activo';

-- DropEnum
DROP TYPE "UsuarioStatus";

-- CreateTable
CREATE TABLE "socios" (
    "socio_id" SERIAL NOT NULL,
    "uuid_socio" VARCHAR(60) NOT NULL,
    "codigo_socio" VARCHAR(30) NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "apellido_paterno" VARCHAR(120) NOT NULL,
    "apellido_materno" VARCHAR(120),
    "correo" VARCHAR(160),
    "telefono" VARCHAR(20),
    "foto_url" VARCHAR(255),
    "status" "EstadoGeneral" NOT NULL DEFAULT 'activo',
    "genero" VARCHAR(20),
    "direccion" VARCHAR(255),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "socios_pkey" PRIMARY KEY ("socio_id")
);

-- CreateTable
CREATE TABLE "contratos" (
    "contrato_id" SERIAL NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "descripcion" VARCHAR(255),
    "duracion_dias" INTEGER NOT NULL,
    "status" "EstadoGeneral" NOT NULL DEFAULT 'activo',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contratos_pkey" PRIMARY KEY ("contrato_id")
);

-- CreateTable
CREATE TABLE "socio_contratos" (
    "socio_contrato_id" SERIAL NOT NULL,
    "uuid_socio_contrato" VARCHAR(60) NOT NULL,
    "socio_id" INTEGER NOT NULL,
    "contrato_id" INTEGER,
    "fecha_inicio" TIMESTAMP(3) NOT NULL,
    "fecha_fin" TIMESTAMP(3) NOT NULL,
    "status" "ContratoStatus" NOT NULL DEFAULT 'vigente',
    "archivo_url" VARCHAR(255),
    "observaciones" VARCHAR(255),
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "socio_contratos_pkey" PRIMARY KEY ("socio_contrato_id")
);

-- CreateTable
CREATE TABLE "membresia_planes" (
    "plan_id" SERIAL NOT NULL,
    "uuid_plan" VARCHAR(60) NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "duracion_dias" INTEGER NOT NULL,
    "precio_actual" DECIMAL(10,2) NOT NULL,
    "status" "EstadoGeneral" NOT NULL DEFAULT 'activo',
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membresia_planes_pkey" PRIMARY KEY ("plan_id")
);

-- CreateTable
CREATE TABLE "membresia_socio" (
    "membresia_socio_id" SERIAL NOT NULL,
    "uuid_membresia_socio" VARCHAR(60) NOT NULL,
    "socio_id" INTEGER NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "fecha_inicio" TIMESTAMP(3) NOT NULL,
    "fecha_fin" TIMESTAMP(3) NOT NULL,
    "status" "MembresiaSocioStatus" NOT NULL,
    "estado_pago" "EstadoPago" NOT NULL DEFAULT 'sin_pagar',
    "precio_congelado" DECIMAL(10,2),
    "asignado_por" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membresia_socio_pkey" PRIMARY KEY ("membresia_socio_id")
);

-- CreateTable
CREATE TABLE "metodos_pago" (
    "metodo_pago_id" SERIAL NOT NULL,
    "nombre" VARCHAR(40) NOT NULL,

    CONSTRAINT "metodos_pago_pkey" PRIMARY KEY ("metodo_pago_id")
);

-- CreateTable
CREATE TABLE "pagos_membresia" (
    "pago_membresia_id" SERIAL NOT NULL,
    "membresia_socio_id" INTEGER NOT NULL,
    "metodo_pago_id" INTEGER NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    "referencia" VARCHAR(80),
    "pagado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recibido_por" INTEGER,

    CONSTRAINT "pagos_membresia_pkey" PRIMARY KEY ("pago_membresia_id")
);

-- CreateTable
CREATE TABLE "clases" (
    "clase_id" SERIAL NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "descripcion" VARCHAR(255),
    "cupo" INTEGER,
    "status" "EstadoGeneral" NOT NULL DEFAULT 'activo',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clases_pkey" PRIMARY KEY ("clase_id")
);

-- CreateTable
CREATE TABLE "clase_horarios" (
    "clase_horario_id" SERIAL NOT NULL,
    "clase_id" INTEGER NOT NULL,
    "dia_semana" SMALLINT NOT NULL,
    "hora_inicio" TIME NOT NULL,
    "hora_fin" TIME NOT NULL,

    CONSTRAINT "clase_horarios_pkey" PRIMARY KEY ("clase_horario_id")
);

-- CreateTable
CREATE TABLE "clase_inscripciones" (
    "clase_inscripcion_id" SERIAL NOT NULL,
    "clase_id" INTEGER NOT NULL,
    "socio_id" INTEGER NOT NULL,
    "status" "EstadoGeneral" NOT NULL DEFAULT 'activo',
    "inscrito_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clase_inscripciones_pkey" PRIMARY KEY ("clase_inscripcion_id")
);

-- CreateTable
CREATE TABLE "categorias_producto" (
    "categoria_id" SERIAL NOT NULL,
    "nombre" VARCHAR(80) NOT NULL,

    CONSTRAINT "categorias_producto_pkey" PRIMARY KEY ("categoria_id")
);

-- CreateTable
CREATE TABLE "productos" (
    "producto_id" SERIAL NOT NULL,
    "uuid_producto" VARCHAR(60) NOT NULL,
    "categoria_id" INTEGER NOT NULL,
    "codigo" VARCHAR(60) NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "descripcion" VARCHAR(255),
    "precio" DECIMAL(10,2) NOT NULL,
    "costo" DECIMAL(10,2),
    "status" "EstadoGeneral" NOT NULL DEFAULT 'activo',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "productos_pkey" PRIMARY KEY ("producto_id")
);

-- CreateTable
CREATE TABLE "inventario_stock" (
    "producto_id" INTEGER NOT NULL,
    "cantidad" INTEGER NOT NULL DEFAULT 0,
    "stock_minimo" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventario_stock_pkey" PRIMARY KEY ("producto_id")
);

-- CreateTable
CREATE TABLE "inventario_movimientos" (
    "movimiento_id" SERIAL NOT NULL,
    "producto_id" INTEGER NOT NULL,
    "tipo" "MovimientoInvTipo" NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "costo_unitario" DECIMAL(10,2),
    "referencia_tipo" "ReferenciaInvTipo" NOT NULL,
    "referencia_id" INTEGER,
    "usuario_id" INTEGER,
    "nota" VARCHAR(255),
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventario_movimientos_pkey" PRIMARY KEY ("movimiento_id")
);

-- CreateTable
CREATE TABLE "proveedores" (
    "proveedor_id" SERIAL NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "telefono" VARCHAR(20),
    "email" VARCHAR(160),
    "status" "EstadoGeneral" NOT NULL DEFAULT 'activo',

    CONSTRAINT "proveedores_pkey" PRIMARY KEY ("proveedor_id")
);

-- CreateTable
CREATE TABLE "compras" (
    "compra_id" SERIAL NOT NULL,
    "proveedor_id" INTEGER,
    "usuario_id" INTEGER,
    "fecha_compra" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "CompraStatus" NOT NULL DEFAULT 'registrada',
    "total" DECIMAL(10,2) NOT NULL,
    "observaciones" VARCHAR(255),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "compras_pkey" PRIMARY KEY ("compra_id")
);

-- CreateTable
CREATE TABLE "compra_detalle" (
    "compra_detalle_id" SERIAL NOT NULL,
    "compra_id" INTEGER NOT NULL,
    "producto_id" INTEGER NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "costo_unitario" DECIMAL(10,2) NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "compra_detalle_pkey" PRIMARY KEY ("compra_detalle_id")
);

-- CreateTable
CREATE TABLE "ventas" (
    "venta_id" SERIAL NOT NULL,
    "uuid_venta" VARCHAR(60) NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "fecha_venta" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "VentaStatus" NOT NULL DEFAULT 'exitosa',
    "subtotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "descuento" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(10,2) NOT NULL,
    "observaciones" VARCHAR(255),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ventas_pkey" PRIMARY KEY ("venta_id")
);

-- CreateTable
CREATE TABLE "venta_detalle" (
    "venta_detalle_id" SERIAL NOT NULL,
    "venta_id" INTEGER NOT NULL,
    "producto_id" INTEGER NOT NULL,
    "codigo_producto" VARCHAR(60) NOT NULL,
    "nombre_producto" VARCHAR(120) NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "precio_unitario" DECIMAL(10,2) NOT NULL,
    "costo_unitario" DECIMAL(10,2),
    "subtotal_linea" DECIMAL(10,2) NOT NULL,
    "ganancia_linea" DECIMAL(10,2),

    CONSTRAINT "venta_detalle_pkey" PRIMARY KEY ("venta_detalle_id")
);

-- CreateTable
CREATE TABLE "venta_pagos" (
    "venta_pago_id" SERIAL NOT NULL,
    "venta_id" INTEGER NOT NULL,
    "metodo_pago_id" INTEGER NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    "referencia" VARCHAR(80),
    "pagado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "venta_pagos_pkey" PRIMARY KEY ("venta_pago_id")
);

-- CreateTable
CREATE TABLE "auditoria_log" (
    "auditoria_id" SERIAL NOT NULL,
    "usuario_id" INTEGER,
    "modulo_id" INTEGER,
    "accion" VARCHAR(60) NOT NULL,
    "entidad" VARCHAR(60),
    "entidad_id" INTEGER,
    "detalle" JSONB,
    "ip" VARCHAR(45),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditoria_log_pkey" PRIMARY KEY ("auditoria_id")
);

-- CreateTable
CREATE TABLE "eliminaciones_log" (
    "eliminacion_id" SERIAL NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "tabla" VARCHAR(80) NOT NULL,
    "registro_id" INTEGER NOT NULL,
    "motivo" VARCHAR(255),
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eliminaciones_log_pkey" PRIMARY KEY ("eliminacion_id")
);

-- CreateTable
CREATE TABLE "settings" (
    "setting_key" VARCHAR(80) NOT NULL,
    "setting_value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("setting_key")
);

-- CreateTable
CREATE TABLE "backups_log" (
    "backup_id" SERIAL NOT NULL,
    "tipo" "BackupTipo" NOT NULL,
    "archivo" VARCHAR(255) NOT NULL,
    "ruta_local" VARCHAR(255) NOT NULL,
    "ruta_remota" VARCHAR(255),
    "tamano_mb" DECIMAL(10,2),
    "checksum" VARCHAR(128),
    "status" "ProcesoStatus" NOT NULL,
    "error" VARCHAR(255),
    "generado_por" INTEGER,
    "generado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backups_log_pkey" PRIMARY KEY ("backup_id")
);

-- CreateTable
CREATE TABLE "restores_log" (
    "restore_id" SERIAL NOT NULL,
    "backup_id" INTEGER NOT NULL,
    "restaurado_por" INTEGER NOT NULL,
    "restaurado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ProcesoStatus" NOT NULL,
    "error" VARCHAR(255),

    CONSTRAINT "restores_log_pkey" PRIMARY KEY ("restore_id")
);

-- CreateTable
CREATE TABLE "cortes_caja" (
    "corte_id" SERIAL NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fin" TIMESTAMP(3) NOT NULL,
    "total_ventas" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "status" "CorteCajaStatus" NOT NULL DEFAULT 'cerrado',
    "observaciones" VARCHAR(255),

    CONSTRAINT "cortes_caja_pkey" PRIMARY KEY ("corte_id")
);

-- CreateTable
CREATE TABLE "conceptos" (
    "concepto_id" SERIAL NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "tipo" "ConceptoTipo" NOT NULL,
    "status" "EstadoGeneral" NOT NULL DEFAULT 'activo',

    CONSTRAINT "conceptos_pkey" PRIMARY KEY ("concepto_id")
);

-- CreateTable
CREATE TABLE "caja_movimientos" (
    "movimiento_caja_id" SERIAL NOT NULL,
    "corte_id" INTEGER,
    "usuario_id" INTEGER NOT NULL,
    "concepto_id" INTEGER NOT NULL,
    "tipo" "ConceptoTipo" NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    "referencia_tipo" "CajaRefTipo" NOT NULL,
    "referencia_id" INTEGER,
    "nota" VARCHAR(255),
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "caja_movimientos_pkey" PRIMARY KEY ("movimiento_caja_id")
);

-- CreateTable
CREATE TABLE "accesos" (
    "acceso_id" SERIAL NOT NULL,
    "socio_id" INTEGER NOT NULL,
    "tipo" "AccesoTipo" NOT NULL,
    "fecha_hora" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validado" BOOLEAN NOT NULL DEFAULT true,
    "motivo" VARCHAR(255),
    "usuario_id" INTEGER,
    "dispositivo_id" VARCHAR(60),

    CONSTRAINT "accesos_pkey" PRIMARY KEY ("acceso_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "socios_uuid_socio_key" ON "socios"("uuid_socio");

-- CreateIndex
CREATE UNIQUE INDEX "socios_codigo_socio_key" ON "socios"("codigo_socio");

-- CreateIndex
CREATE INDEX "socios_status_idx" ON "socios"("status");

-- CreateIndex
CREATE INDEX "socios_telefono_idx" ON "socios"("telefono");

-- CreateIndex
CREATE UNIQUE INDEX "socio_contratos_uuid_socio_contrato_key" ON "socio_contratos"("uuid_socio_contrato");

-- CreateIndex
CREATE INDEX "socio_contratos_socio_id_fecha_fin_idx" ON "socio_contratos"("socio_id", "fecha_fin");

-- CreateIndex
CREATE INDEX "socio_contratos_status_idx" ON "socio_contratos"("status");

-- CreateIndex
CREATE UNIQUE INDEX "membresia_planes_uuid_plan_key" ON "membresia_planes"("uuid_plan");

-- CreateIndex
CREATE UNIQUE INDEX "membresia_socio_uuid_membresia_socio_key" ON "membresia_socio"("uuid_membresia_socio");

-- CreateIndex
CREATE INDEX "membresia_socio_socio_id_fecha_fin_idx" ON "membresia_socio"("socio_id", "fecha_fin");

-- CreateIndex
CREATE INDEX "membresia_socio_estado_pago_idx" ON "membresia_socio"("estado_pago");

-- CreateIndex
CREATE UNIQUE INDEX "metodos_pago_nombre_key" ON "metodos_pago"("nombre");

-- CreateIndex
CREATE INDEX "pagos_membresia_pagado_en_idx" ON "pagos_membresia"("pagado_en");

-- CreateIndex
CREATE INDEX "clase_horarios_clase_id_dia_semana_idx" ON "clase_horarios"("clase_id", "dia_semana");

-- CreateIndex
CREATE UNIQUE INDEX "categorias_producto_nombre_key" ON "categorias_producto"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "productos_uuid_producto_key" ON "productos"("uuid_producto");

-- CreateIndex
CREATE UNIQUE INDEX "productos_codigo_key" ON "productos"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "ventas_uuid_venta_key" ON "ventas"("uuid_venta");

-- CreateIndex
CREATE UNIQUE INDEX "conceptos_nombre_key" ON "conceptos"("nombre");

-- AddForeignKey
ALTER TABLE "socios" ADD CONSTRAINT "socios_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "usuarios"("usuario_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "socio_contratos" ADD CONSTRAINT "socio_contratos_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("socio_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "socio_contratos" ADD CONSTRAINT "socio_contratos_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "contratos"("contrato_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "socio_contratos" ADD CONSTRAINT "socio_contratos_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "usuarios"("usuario_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membresia_planes" ADD CONSTRAINT "membresia_planes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "usuarios"("usuario_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membresia_socio" ADD CONSTRAINT "membresia_socio_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("socio_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membresia_socio" ADD CONSTRAINT "membresia_socio_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "membresia_planes"("plan_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membresia_socio" ADD CONSTRAINT "membresia_socio_asignado_por_fkey" FOREIGN KEY ("asignado_por") REFERENCES "usuarios"("usuario_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos_membresia" ADD CONSTRAINT "pagos_membresia_membresia_socio_id_fkey" FOREIGN KEY ("membresia_socio_id") REFERENCES "membresia_socio"("membresia_socio_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos_membresia" ADD CONSTRAINT "pagos_membresia_metodo_pago_id_fkey" FOREIGN KEY ("metodo_pago_id") REFERENCES "metodos_pago"("metodo_pago_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos_membresia" ADD CONSTRAINT "pagos_membresia_recibido_por_fkey" FOREIGN KEY ("recibido_por") REFERENCES "usuarios"("usuario_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clase_horarios" ADD CONSTRAINT "clase_horarios_clase_id_fkey" FOREIGN KEY ("clase_id") REFERENCES "clases"("clase_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clase_inscripciones" ADD CONSTRAINT "clase_inscripciones_clase_id_fkey" FOREIGN KEY ("clase_id") REFERENCES "clases"("clase_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clase_inscripciones" ADD CONSTRAINT "clase_inscripciones_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("socio_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productos" ADD CONSTRAINT "productos_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias_producto"("categoria_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventario_stock" ADD CONSTRAINT "inventario_stock_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("producto_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventario_movimientos" ADD CONSTRAINT "inventario_movimientos_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("producto_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventario_movimientos" ADD CONSTRAINT "inventario_movimientos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("usuario_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compras" ADD CONSTRAINT "compras_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "proveedores"("proveedor_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compras" ADD CONSTRAINT "compras_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("usuario_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compra_detalle" ADD CONSTRAINT "compra_detalle_compra_id_fkey" FOREIGN KEY ("compra_id") REFERENCES "compras"("compra_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compra_detalle" ADD CONSTRAINT "compra_detalle_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("producto_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ventas" ADD CONSTRAINT "ventas_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("usuario_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venta_detalle" ADD CONSTRAINT "venta_detalle_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "ventas"("venta_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venta_detalle" ADD CONSTRAINT "venta_detalle_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("producto_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venta_pagos" ADD CONSTRAINT "venta_pagos_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "ventas"("venta_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venta_pagos" ADD CONSTRAINT "venta_pagos_metodo_pago_id_fkey" FOREIGN KEY ("metodo_pago_id") REFERENCES "metodos_pago"("metodo_pago_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria_log" ADD CONSTRAINT "auditoria_log_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("usuario_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eliminaciones_log" ADD CONSTRAINT "eliminaciones_log_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("usuario_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "usuarios"("usuario_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backups_log" ADD CONSTRAINT "backups_log_generado_por_fkey" FOREIGN KEY ("generado_por") REFERENCES "usuarios"("usuario_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restores_log" ADD CONSTRAINT "restores_log_backup_id_fkey" FOREIGN KEY ("backup_id") REFERENCES "backups_log"("backup_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restores_log" ADD CONSTRAINT "restores_log_restaurado_por_fkey" FOREIGN KEY ("restaurado_por") REFERENCES "usuarios"("usuario_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cortes_caja" ADD CONSTRAINT "cortes_caja_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("usuario_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caja_movimientos" ADD CONSTRAINT "caja_movimientos_corte_id_fkey" FOREIGN KEY ("corte_id") REFERENCES "cortes_caja"("corte_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caja_movimientos" ADD CONSTRAINT "caja_movimientos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("usuario_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caja_movimientos" ADD CONSTRAINT "caja_movimientos_concepto_id_fkey" FOREIGN KEY ("concepto_id") REFERENCES "conceptos"("concepto_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accesos" ADD CONSTRAINT "accesos_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("socio_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accesos" ADD CONSTRAINT "accesos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("usuario_id") ON DELETE SET NULL ON UPDATE CASCADE;

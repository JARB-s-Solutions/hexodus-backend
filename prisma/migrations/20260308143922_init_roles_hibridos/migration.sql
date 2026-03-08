/*
  Warnings:

  - The primary key for the `auditoria_log` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `created_at` on the `auditoria_log` table. All the data in the column will be lost.
  - You are about to drop the column `detalle` on the `auditoria_log` table. All the data in the column will be lost.
  - You are about to drop the column `entidad` on the `auditoria_log` table. All the data in the column will be lost.
  - You are about to drop the column `entidad_id` on the `auditoria_log` table. All the data in the column will be lost.
  - You are about to drop the column `modulo_id` on the `auditoria_log` table. All the data in the column will be lost.
  - You are about to alter the column `accion` on the `auditoria_log` table. The data in that column could be lost. The data in that column will be cast from `VarChar(60)` to `VarChar(50)`.
  - The primary key for the `roles` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `created_at` on the `roles` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `roles` table. All the data in the column will be lost.
  - You are about to drop the `rol_modulo_permisos` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "rol_modulo_permisos" DROP CONSTRAINT "rol_modulo_permisos_rol_id_fkey";

-- DropForeignKey
ALTER TABLE "usuarios" DROP CONSTRAINT "usuarios_rol_id_fkey";

-- AlterTable
ALTER TABLE "auditoria_log" DROP CONSTRAINT "auditoria_log_pkey",
DROP COLUMN "created_at",
DROP COLUMN "detalle",
DROP COLUMN "entidad",
DROP COLUMN "entidad_id",
DROP COLUMN "modulo_id",
ADD COLUMN     "descripcion" TEXT,
ADD COLUMN     "detalles" JSONB,
ADD COLUMN     "modulo" VARCHAR(50),
ADD COLUMN     "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "user_agent" TEXT,
ALTER COLUMN "auditoria_id" DROP DEFAULT,
ALTER COLUMN "auditoria_id" SET DATA TYPE VARCHAR(50),
ALTER COLUMN "accion" SET DATA TYPE VARCHAR(50),
ADD CONSTRAINT "auditoria_log_pkey" PRIMARY KEY ("auditoria_id");
DROP SEQUENCE "auditoria_log_auditoria_id_seq";

-- AlterTable
ALTER TABLE "roles" DROP CONSTRAINT "roles_pkey",
DROP COLUMN "created_at",
DROP COLUMN "status",
ADD COLUMN     "color" VARCHAR(7),
ADD COLUMN     "creado_por" INTEGER,
ADD COLUMN     "es_administrador" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "es_sistema" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fecha_actualizacion" TIMESTAMP(3),
ADD COLUMN     "fecha_creacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "icono" VARCHAR(10),
ADD COLUMN     "permisos" JSONB NOT NULL DEFAULT '{}',
ALTER COLUMN "rol_id" DROP DEFAULT,
ALTER COLUMN "rol_id" SET DATA TYPE VARCHAR(50),
ALTER COLUMN "nombre" SET DATA TYPE VARCHAR(100),
ALTER COLUMN "descripcion" SET DATA TYPE TEXT,
ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("rol_id");
DROP SEQUENCE "roles_rol_id_seq";

-- AlterTable
ALTER TABLE "usuarios" ALTER COLUMN "rol_id" SET DATA TYPE VARCHAR(50);

-- DropTable
DROP TABLE "rol_modulo_permisos";

-- CreateTable
CREATE TABLE "historial_roles" (
    "id" SERIAL NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "rol_id" VARCHAR(50) NOT NULL,
    "rol_nombre" VARCHAR(100),
    "fecha_asignacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "asignado_por" INTEGER,
    "observaciones" TEXT,

    CONSTRAINT "historial_roles_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "roles"("rol_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historial_roles" ADD CONSTRAINT "historial_roles_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("usuario_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historial_roles" ADD CONSTRAINT "historial_roles_asignado_por_fkey" FOREIGN KEY ("asignado_por") REFERENCES "usuarios"("usuario_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historial_roles" ADD CONSTRAINT "historial_roles_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "roles"("rol_id") ON DELETE RESTRICT ON UPDATE CASCADE;

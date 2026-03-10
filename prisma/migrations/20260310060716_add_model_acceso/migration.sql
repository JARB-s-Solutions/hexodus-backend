-- AlterEnum
ALTER TYPE "AccesoTipo" ADD VALUE 'DENEGADO';

-- AlterTable
ALTER TABLE "accesos" ADD COLUMN     "estado_acceso" VARCHAR(20) NOT NULL DEFAULT 'permitido',
ADD COLUMN     "motivo_codigo" VARCHAR(30) NOT NULL DEFAULT 'ok';

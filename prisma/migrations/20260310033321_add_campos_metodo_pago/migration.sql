-- AlterTable
ALTER TABLE "metodos_pago" ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "created_by" INTEGER,
ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "is_deleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "status" "EstadoGeneral" NOT NULL DEFAULT 'activo';

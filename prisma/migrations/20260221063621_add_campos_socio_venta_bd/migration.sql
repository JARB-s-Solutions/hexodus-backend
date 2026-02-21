-- AlterTable
ALTER TABLE "ventas" ADD COLUMN     "socio_id" INTEGER;

-- AddForeignKey
ALTER TABLE "ventas" ADD CONSTRAINT "ventas_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("socio_id") ON DELETE SET NULL ON UPDATE CASCADE;

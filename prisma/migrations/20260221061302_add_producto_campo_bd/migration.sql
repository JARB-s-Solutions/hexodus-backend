-- AlterTable
ALTER TABLE "membresia_planes" ADD COLUMN     "descripcion" VARCHAR(255);

-- AlterTable
ALTER TABLE "productos" ADD COLUMN     "marca" VARCHAR(255);

-- AlterTable
ALTER TABLE "socios" ADD COLUMN     "direccion" VARCHAR(255),
ADD COLUMN     "genero" VARCHAR(20);

/*
  Warnings:

  - The primary key for the `categorias_producto` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `categoria_id` on the `categorias_producto` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[prefijo]` on the table `categorias_producto` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `updated_at` to the `categorias_producto` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "CategoriaEstado" AS ENUM ('activa', 'inactiva');

-- DropForeignKey
ALTER TABLE "productos" DROP CONSTRAINT "productos_categoria_id_fkey";

-- AlterTable
ALTER TABLE "categorias_producto" DROP CONSTRAINT "categorias_producto_pkey",
DROP COLUMN "categoria_id",
ADD COLUMN     "color" VARCHAR(7) NOT NULL DEFAULT '#6B7280',
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "descripcion" TEXT,
ADD COLUMN     "estado" "CategoriaEstado" NOT NULL DEFAULT 'activa',
ADD COLUMN     "id" SERIAL NOT NULL,
ADD COLUMN     "prefijo" VARCHAR(6),
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "nombre" SET DATA TYPE VARCHAR(100),
ADD CONSTRAINT "categorias_producto_pkey" PRIMARY KEY ("id");

-- CreateIndex
CREATE UNIQUE INDEX "categorias_producto_prefijo_key" ON "categorias_producto"("prefijo");

-- AddForeignKey
ALTER TABLE "productos" ADD CONSTRAINT "productos_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias_producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

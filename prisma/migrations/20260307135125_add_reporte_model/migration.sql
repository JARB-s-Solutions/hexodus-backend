-- CreateTable
CREATE TABLE "reportes_financieros" (
    "reporte_id" SERIAL NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "descripcion" VARCHAR(255),
    "tipo" VARCHAR(60) NOT NULL,
    "formato" VARCHAR(20) NOT NULL,
    "fecha_inicio" TIMESTAMP(3) NOT NULL,
    "fecha_fin" TIMESTAMP(3) NOT NULL,
    "incluir_graficos" BOOLEAN NOT NULL DEFAULT false,
    "incluir_detalles" BOOLEAN NOT NULL DEFAULT false,
    "estado" VARCHAR(40) NOT NULL DEFAULT 'Exitoso',
    "archivo_url" VARCHAR(255),
    "generado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuario_id" INTEGER NOT NULL,

    CONSTRAINT "reportes_financieros_pkey" PRIMARY KEY ("reporte_id")
);

-- AddForeignKey
ALTER TABLE "reportes_financieros" ADD CONSTRAINT "reportes_financieros_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("usuario_id") ON DELETE RESTRICT ON UPDATE CASCADE;

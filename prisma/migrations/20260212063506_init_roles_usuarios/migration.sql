-- CreateEnum
CREATE TYPE "UsuarioStatus" AS ENUM ('activo', 'inactivo');

-- CreateTable
CREATE TABLE "usuarios" (
    "usuario_id" SERIAL NOT NULL,
    "uid" VARCHAR(60) NOT NULL,
    "username" VARCHAR(60) NOT NULL,
    "nombre_completo" VARCHAR(120) NOT NULL,
    "email" VARCHAR(160) NOT NULL,
    "telefono" VARCHAR(20),
    "status" "UsuarioStatus" NOT NULL DEFAULT 'activo',
    "password" VARCHAR(255) NOT NULL,
    "ultimo_acceso" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),
    "rol_id" INTEGER NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("usuario_id")
);

-- CreateTable
CREATE TABLE "roles" (
    "rol_id" SERIAL NOT NULL,
    "nombre" VARCHAR(60) NOT NULL,
    "descripcion" VARCHAR(255),
    "status" TEXT NOT NULL DEFAULT 'activo',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("rol_id")
);

-- CreateTable
CREATE TABLE "rol_modulo_permisos" (
    "permiso_id" SERIAL NOT NULL,
    "rol_id" INTEGER NOT NULL,
    "modulo" VARCHAR(80) NOT NULL,
    "can_view" BOOLEAN NOT NULL DEFAULT true,
    "can_create" BOOLEAN NOT NULL DEFAULT false,
    "can_edit" BOOLEAN NOT NULL DEFAULT false,
    "can_delete" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "rol_modulo_permisos_pkey" PRIMARY KEY ("permiso_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_uid_key" ON "usuarios"("uid");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_username_key" ON "usuarios"("username");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "roles_nombre_key" ON "roles"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "rol_modulo_permisos_rol_id_modulo_key" ON "rol_modulo_permisos"("rol_id", "modulo");

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "roles"("rol_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rol_modulo_permisos" ADD CONSTRAINT "rol_modulo_permisos_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "roles"("rol_id") ON DELETE CASCADE ON UPDATE CASCADE;

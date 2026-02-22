import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const prisma = new PrismaClient();

async function main() {
    console.log(" Iniciando la creación del Super Administrador...");

    try {
        // 1. Buscar o crear el Rol de Administrador
        let rolAdmin = await prisma.rol.findUnique({
            where: { nombre: 'Administrador' }
        });

        if (!rolAdmin) {
            console.log(" Rol 'Administrador' no encontrado. Creándolo...");
            rolAdmin = await prisma.rol.create({
                data: {
                    nombre: 'Administrador',
                    descripcion: 'Acceso total a todos los módulos del sistema',
                    status: 'activo'
                }
            });
            console.log(" Rol 'Administrador' creado.");
        }

        // 2. Configuración de credenciales del Admin
        const adminData = {
            username: 'admin',
            email: 'al071392@uacam.mx',
            nombreCompleto: 'Administrador General',
            passwordPlain: 'Admin1234' 
        };

        // 3. Verificar si el correo o username ya existen
        const existeAdmin = await prisma.usuario.findUnique({
            where: { email: adminData.email }
        });

        if (existeAdmin) {
            console.log(` El usuario con el correo ${adminData.email} ya existe en la base de datos.`);
            return;
        }

        // 4. Encriptar la contraseña (Regla de seguridad obligatoria)
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(adminData.passwordPlain, salt);

        // 5. Insertar el usuario en la Base de Datos
        const nuevoAdmin = await prisma.usuario.create({
            data: {
                uid: crypto.randomUUID(), // Genera un identificador único (UUID)
                username: adminData.username,
                email: adminData.email,
                nombreCompleto: adminData.nombreCompleto,
                password: passwordHash,
                rolId: rolAdmin.id,
                status: 'activo' // Coincide con el enum EstadoGeneral
            }
        });

        console.log(" ¡Super Administrador creado con éxito!");
        console.log("-------------------------------------------------");
        console.log(` Usuario: ${nuevoAdmin.username}`);
        console.log(` Correo:  ${nuevoAdmin.email}`);
        console.log(` Clave:   ${adminData.passwordPlain}`);
        console.log("-------------------------------------------------");
        console.log("Ya puedes ir a Postman y probar el endpoint de Login.");

    } catch (error) {
        console.error(" Error al crear el administrador:", error);
    } finally {
        // 6. Desconectar Prisma al terminar
        await prisma.$disconnect();
    }
}

main();
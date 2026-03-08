import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const prisma = new PrismaClient();

async function main() {
    console.log("🛡️ Iniciando la actualización del Super Administrador...");

    try {
        // 0. SOLUCIÓN AL ERROR: Liberar el nombre 'Administrador' si un rol viejo lo tiene
        const rolAntiguo = await prisma.rol.findUnique({ where: { nombre: 'Administrador' } });
        
        if (rolAntiguo && rolAntiguo.id !== 'admin') {
            console.log("⚠️ Se detectó un rol 'Administrador' con ID antiguo. Liberando el nombre...");
            await prisma.rol.update({
                where: { id: rolAntiguo.id },
                data: { nombre: 'Administrador_Legacy_' + Date.now() }
            });
        }

        // 1. Crear o actualizar el Rol con el NUEVO esquema híbrido (ID: 'admin')
        const rolAdmin = await prisma.rol.upsert({
            where: { id: 'admin' }, 
            update: {
                nombre: 'Administrador',
                esAdministrador: true, // LA LLAVE MAESTRA
                esSistema: true,
                permisos: { "todo": "absoluto" } 
            },
            create: {
                id: 'admin',
                nombre: 'Administrador',
                descripcion: 'Acceso total a todos los módulos del sistema',
                esAdministrador: true,
                esSistema: true,
                permisos: { "todo": "absoluto" }
            }
        });
        console.log("✅ Rol 'admin' configurado con poderes absolutos.");

        const adminData = {
            username: 'admin',
            email: 'al071392@uacam.mx',
            nombreCompleto: 'Administrador General',
            passwordPlain: 'Admin1234' 
        };

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(adminData.passwordPlain, salt);

        // 2. Crear o Actualizar al Usuario
        const adminUser = await prisma.usuario.upsert({
            where: { username: adminData.username },
            update: {
                rolId: rolAdmin.id, 
                password: passwordHash,
                status: 'activo' // Aseguramos que tenga paso libre
            },
            create: {
                uid: crypto.randomUUID(),
                username: adminData.username,
                email: adminData.email,
                nombreCompleto: adminData.nombreCompleto,
                password: passwordHash,
                rolId: rolAdmin.id,
                status: 'activo'
            }
        });

        console.log("✅ ¡Super Administrador listo y blindado!");
        console.log("-------------------------------------------------");
        console.log(`Usuario: ${adminUser.username}`);
        console.log(`Clave:   ${adminData.passwordPlain}`);
        console.log("-------------------------------------------------");

    } catch (error) {
        console.error("❌ Error al crear el administrador:", error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
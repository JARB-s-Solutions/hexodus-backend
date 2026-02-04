import { success } from 'zod';
import { db } from '../config/firebase.js';

export const crearSocio = async (req, res) => {
    try {
        const { nombre, email, telefono } = req.body;

        // Validación básica
        if (!nombre || !email) {
            return res.status(400).json({
                success: false,
                msg: "Faltan datos obligatorios (nombre, email)"
            });
        }

        // Crear el objeto socio
        const nuevoSocio = {
            nombre,
            email,
            telefono: telefono || "",
            fechaRegistro: new Date(),
            activo: true
        };

        // Guardar en Firestore (Colección 'socios')
        const docRef = await db.collection('socios').add(nuevoSocio);

        // Responder al cliente
        return res.status(201).json({
            success: true,
            msg: "Socio registrado con éxito",
            id: docRef.id,
            data: nuevoSocio
        });

    } catch (error) {
        console.error("Error en crearSocio:", error);
        return res.status(500).json({
            success: false,
            msg: "Error interno del servidor"
        });
    }
};

export const obtenerSocios = async (req, res) => {
    try {
        const snapshot = await db.collection('socios').get();
        // Transformar el snapshot en un array limpio
        const socios = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        res.json({
            success: true,
            total: socios.length,
            data: socios
        });
    } catch (error) {
        res.status(500).json({ success: false, msg: error.message });
    }
};
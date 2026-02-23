import { Router } from "express";
import { crearMembresia, 
    listarMembresias, 
    obtenerMembresia, 
    editarMembresia, 
    cambiarStatusMembresia,
    eliminarMembresia
    } from "../controller/membresiaController.js";
import { verificarToken } from "../middlewares/authMiddleware.js"

const router = Router();

// Ruta para crear una membresía.
router.post("/", verificarToken, crearMembresia);
// Lista de membresías con filtros, paginación y conteo de socios.
router.get("/", verificarToken, listarMembresias);
// Ruta para obtener una membresía por su ID.
router.get("/:id", verificarToken, obtenerMembresia);
// Ruta para editar una membresía por su ID.
router.put("/:id", verificarToken, editarMembresia);
// Ruta para cambiar el status de una membresía por su ID.
router.patch("/:id/status", verificarToken, cambiarStatusMembresia);
// Ruta para eliminar una membresía por su ID.
router.delete("/:id", verificarToken, eliminarMembresia);

export default router;
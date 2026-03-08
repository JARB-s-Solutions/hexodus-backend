import { Router } from "express";
import { 
    crearMembresia, 
    listarMembresias, 
    obtenerMembresia, 
    editarMembresia, 
    cambiarStatusMembresia,
    eliminarMembresia
} from "../controller/membresiaController.js";
import { verificarToken, verificarPermiso } from "../middlewares/authMiddleware.js";

const router = Router();

// Todas las rutas requieren estar logueado
router.use(verificarToken);

// Permisos por acción (Módulo: membresias)

// Rutas de visualización
router.get("/", verificarPermiso("membresias", "ver"), listarMembresias);
router.get("/:id", verificarPermiso("membresias", "ver"), obtenerMembresia);

// Rutas de creación y modificación
router.post("/", verificarPermiso("membresias", "crear"), crearMembresia);
router.put("/:id", verificarPermiso("membresias", "editar"), editarMembresia);
router.patch("/:id/status", verificarPermiso("membresias", "editar"), cambiarStatusMembresia);

// Rutas de eliminación
router.delete("/:id", verificarPermiso("membresias", "eliminar"), eliminarMembresia);

export default router;
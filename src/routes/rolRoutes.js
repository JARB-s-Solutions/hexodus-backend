import { Router } from "express";
import { listarRoles, crearRol, actualizarRol, eliminarRol } from "../controller/rolController.js";
import { verificarToken, verificarPermiso } from "../middlewares/authMiddleware.js";

const router = Router();

// Todas las rutas requieren token
router.use(verificarToken);

// Solo los que tengan permiso en el módulo 'roles' pueden acceder
router.get("/", verificarPermiso("roles", "ver"), listarRoles);
router.post("/", verificarPermiso("roles", "crear"), crearRol);
router.patch("/:id", verificarPermiso("roles", "editar"), actualizarRol);
router.delete("/:id", verificarPermiso("roles", "eliminar"), eliminarRol);

export default router;
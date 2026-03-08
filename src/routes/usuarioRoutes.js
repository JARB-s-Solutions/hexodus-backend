import { Router } from "express";
import { 
    listarUsuarios, 
    crearUsuario, 
    obtenerUsuario, 
    actualizarUsuario, 
    eliminarUsuario 
} from "../controller/usuarioController.js";
import { verificarToken, verificarPermiso } from "../middlewares/authMiddleware.js";

const router = Router();

// Todas las rutas requieren token
router.use(verificarToken);

// Rutas base
router.get("/", verificarPermiso("usuarios", "ver"), listarUsuarios);
router.post("/", verificarPermiso("usuarios", "crear"), crearUsuario);

// Rutas con ID
router.get("/:id", verificarPermiso("usuarios", "ver"), obtenerUsuario);
router.patch("/:id", verificarPermiso("usuarios", "editar"), actualizarUsuario);
router.delete("/:id", verificarPermiso("usuarios", "eliminar"), eliminarUsuario);

export default router;
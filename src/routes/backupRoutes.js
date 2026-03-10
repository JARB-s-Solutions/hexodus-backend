import { Router } from "express";
import { 
    crearBackup, 
    obtenerHistorialBackups, 
    descargarBackup 
} from "../controller/backupController.js";
import { verificarToken, verificarPermiso } from "../middlewares/authMiddleware.js";

const router = Router();
router.use(verificarToken);

// Solo usuarios con permisos muy altos (Ej: rol 'Admin' con permiso en configuracion/backups)
router.post("/", verificarPermiso("configuracion", "editar"), crearBackup);
router.get("/", verificarPermiso("configuracion", "ver"), obtenerHistorialBackups);
router.get("/descargar/:fileName", verificarPermiso("configuracion", "ver"), descargarBackup);

export default router;
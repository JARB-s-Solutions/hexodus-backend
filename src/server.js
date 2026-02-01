import app from "./app.js";
import dotenv from "dotenv";

// Cargar variables de entorno desde el archivo .env
dotenv.config();

// Obtener el puerto desde las variables de entorno o usar el 3000 por defecto
const PORT = process.env.PORT || 3000;

// Iniciar el servidor
const startServer = () => {
    try {
        app.listen(PORT, () => {
            console.log(`\n✅ Servidor corriendo en el puerto http://localhost:${PORT}`);
            console.log(`🔹 Ambiente: ${process.env.NODE_ENV || 'development'}`);
        });
    } catch (error) {
        console.log('Error al iniciar el servidor:', error);
        process.exit(1);
    }
};

startServer();
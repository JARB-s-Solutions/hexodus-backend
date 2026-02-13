import app from './app.js';
import "dotenv/config";

const PORT = process.env.PORT || 3000;

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
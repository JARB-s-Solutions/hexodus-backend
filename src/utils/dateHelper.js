export const aHoraCampeche = (fechaUtc) => {
    if (!fechaUtc) return null;
    
    // 1. Forzamos la fecha a la zona horaria de la península
    const opciones = {
        timeZone: 'America/Merida', // Zona horaria oficial para Campeche
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    };
    
    // Esto nos devuelve algo como "09/03/2026, 10:00:00"
    const fechaLocal = new Intl.DateTimeFormat('es-MX', opciones).format(new Date(fechaUtc));
    
    // 2. Lo separamos y lo armamos como un ISO estándar "YYYY-MM-DDTHH:mm:ss"
    // Al no ponerle la 'Z' al final, el Frontend lo tomará como hora 100% local.
    const [fechaParte, horaParte] = fechaLocal.split(', ');
    const [dia, mes, anio] = fechaParte.split('/');
    
    return `${anio}-${mes}-${dia}T${horaParte}`;
};
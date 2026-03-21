import nodemailer from 'nodemailer';

export const sendEmail = async (options) => {
  const safeName = options.name || 'Usuario';
  const safeDate = options.date || new Date().toLocaleString('es-MX', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  // Crear el transportador (Configuración del servicio de correo)
  const transporter = nodemailer.createTransport({
    service: 'Gmail',
    auth: {
      user: process.env.EMAIL_USER, 
      pass: process.env.EMAIL_PASS  
    }
  });

  // Definir opciones del correo
  const mailOptions = {
    from: '"Soporte Hexodus Gym" <no-reply@exodusgym.com>',
    to: options.email,
    subject: options.subject,
    text: options.message,
    html: `
      <div style="margin:0; padding:0; background:#070f2b; width:100%;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#070f2b; padding:24px 10px;">
          <tr>
            <td align="center">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="680" style="width:680px; max-width:680px; background:#061338; border:1px solid #1a2752; border-radius:18px; overflow:hidden;">
                <tr>
                  <td align="center" style="padding:32px 24px 14px 24px;">
                    <div style="width:74px; height:74px; line-height:74px; text-align:center; border-radius:14px; background:#79d1ff; color:#0a1739; font-size:28px; font-weight:700; font-family:Arial, sans-serif;">⎔</div>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:0 24px 6px 24px; font-family:Arial, sans-serif; font-size:34px; font-weight:800; letter-spacing:1px; color:#ff2323; line-height:1;">HEXODUS</td>
                </tr>
                <tr>
                  <td align="center" style="padding:8px 24px 4px 24px; font-family:Arial, sans-serif; color:#f4f7ff; font-size:30px; font-weight:700; line-height:1.12;">Restablecer Contrase\u00f1a</td>
                </tr>
                <tr>
                  <td align="center" style="padding:0 24px 24px 24px; font-family:Arial, sans-serif; color:#9fb0d8; font-size:14px;">${safeDate}</td>
                </tr>
                <tr>
                  <td style="padding:0 20px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid #1f3e73; border-radius:14px; background:#020a23;">
                      <tr>
                        <td style="padding:16px; width:56px;" valign="top">
                          <div style="width:48px; height:48px; background:#1b2d4a; border-radius:9px; text-align:center; line-height:48px; font-size:24px;">🔐</div>
                        </td>
                        <td style="padding:16px 16px 16px 0;" valign="top">
                          <div style="font-family:Arial, sans-serif; color:#ffffff; font-size:22px; font-weight:700; margin-bottom:8px;">${safeName}</div>
                          <div style="font-family:Arial, sans-serif; color:#e6ecff; font-size:18px; line-height:1.55;">
                            Hemos recibido una solicitud para restablecer tu contrase\u00f1a en <strong>HEXODUS FITNESS CENTER</strong>. Si realizaste esta solicitud, haz clic en el bot\u00f3n de abajo para continuar.
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:34px 24px 12px 24px;">
                    <a href="${options.link}" style="display:inline-block; background:#ff1313; color:#ffffff; text-decoration:none; font-family:Arial, sans-serif; font-size:20px; font-weight:700; border-radius:12px; padding:14px 28px;">Restablecer Contrase\u00f1a</a>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:8px 24px 0 24px; font-family:Arial, sans-serif; color:#c4d0f0; font-size:17px;">
                    Este enlace expirar\u00e1 en <strong>15 minutos</strong>.
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:18px 24px 30px 24px; font-family:Arial, sans-serif; color:#9fb0d8; font-size:16px; line-height:1.6;">
                    Si no solicitaste este cambio, puedes ignorar este correo de forma segura.
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 24px 14px 24px;">
                    <div style="height:1px; background:#2a406f;"></div>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:10px 24px 8px 24px; font-family:Arial, sans-serif; color:#6f7f9f; font-size:13px;">
                    Este correo fue generado autom\u00e1ticamente desde el sistema.
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:0 24px 28px 24px; font-family:Arial, sans-serif; color:#ff1a1a; font-size:15px; font-weight:800; letter-spacing:0.5px;">
                    HEXODUS FITNESS CENTER
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </div>
    `
  };

  // Enviar
  await transporter.sendMail(mailOptions);
};
import nodemailer from "nodemailer";

const createTransporter = () =>
  nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || "Gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

export const sendSocioOtpEmail = async ({ to, name, code, expiresInMinutes }) => {
  const transporter = createTransporter();
  const from = process.env.EMAIL_FROM || '"Hexodus Fitness Center" <no-reply@hexodusgym.com>';

  await transporter.sendMail({
    from,
    to,
    subject: "Tu código de acceso a Hexodus",
    text: `Hola ${name}. Tu código de acceso a Hexodus es ${code}. Expira en ${expiresInMinutes} minutos.`,
    html: `
      <div style="margin:0;padding:0;background:#040607;color:#ffffff;font-family:Arial,sans-serif;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#040607;padding:28px 12px;">
          <tr>
            <td align="center">
              <table role="presentation" width="620" cellpadding="0" cellspacing="0" style="width:620px;max-width:620px;background:#101214;border:1px solid #2b2d31;border-radius:26px;overflow:hidden;">
                <tr>
                  <td style="padding:34px 32px 10px 32px;">
                    <div style="color:#ff3448;font-size:14px;font-weight:800;letter-spacing:2px;text-transform:uppercase;">Hexodus Fitness Center</div>
                    <h1 style="margin:14px 0 8px 0;color:#ffffff;font-size:34px;line-height:1.08;">Código de acceso</h1>
                    <p style="margin:0;color:#b7b8bd;font-size:18px;line-height:1.5;">Hola ${name}, usa este código para vincular tu app con tu perfil de socio.</p>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:28px 32px;">
                    <div style="display:inline-block;background:#19080b;border:1px solid #5c1822;border-radius:22px;padding:20px 28px;color:#ff3448;font-size:42px;font-weight:900;letter-spacing:10px;">${code}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 32px 32px 32px;color:#a5a6aa;font-size:15px;line-height:1.6;">
                    Este código expira en <strong style="color:#ffffff;">${expiresInMinutes} minutos</strong>. Si no solicitaste el acceso, puedes ignorar este correo.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </div>
    `,
  });
};

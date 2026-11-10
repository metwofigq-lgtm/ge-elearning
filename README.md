# GE E-Learning

Spanish-first educational marketplace and institution LMS for Equatorial Guinea.

## Deployment approach

- First target: `https://edu.senosl.com` on an isolated staging application on the Seno S.L. VPS.
- Preserve existing Odoo, farm, and other production applications.
- GitHub Actions deployment must use a dedicated restricted account and encrypted repository/environment secrets; never commit SSH private keys.
- Initial VPS-based online access precedes the 3Play Santa María offline replica and later location replicas.
- All credentials, payments, student records, and institution tenant data require secure server-side controls.

Status: repository initialized; application, HTTPS virtual host, and deployment workflow are not yet installed.

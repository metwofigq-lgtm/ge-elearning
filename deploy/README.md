# GE E-Learning staging deployment
The app is intentionally bound to 127.0.0.1:4187 and must be exposed only through a dedicated HTTPS Nginx vhost for edu.senosl.com.
No existing production Nginx sites should be modified or replaced.
The staging landing page does not implement login, payments, or a student database.
A restricted deployment user and GitHub Actions environment secrets must be configured before enabling automated deployments.
Never upload a private key into this public repository. Never reuse the VPS-hosted private key as a repository file.
After Nginx is configured, test with nginx -t before reloading; use certbot to issue a certificate for edu.senosl.com.

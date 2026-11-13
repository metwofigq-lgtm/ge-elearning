# Staging operations

The dedicated edu.senosl.com HTTPS virtual host proxies to 127.0.0.1:4187 on the Seno S.L. VPS. The checkout is in /home/ubuntu/ge-elearning. The ubuntu user's reboot cron entry uses flock and deploy/start-on-boot.sh to launch Node. The launcher writes to /home/ubuntu/ge-elearning-staging.log.

Default application data lives under ~/.local/share/ge-elearning, and the administrator credential record lives under ~/.config/ge-elearning/admin.json. Keep both outside the checkout. An isolated test process must have its own PORT, GE_COURSE_DIR and GE_ADMIN_CREDENTIAL_FILE.

## Release verification

1. Check the GitHub Actions result for the intended commit and inspect git status on the VPS.
2. Fast-forward the staging checkout to the verified commit and run npm run check. Restart only the GE E-Learning process when runtime files changed.
3. Fetch https://edu.senosl.com/health and confirm the service reports ge-elearning in staging mode. Check the student catalog returns 200 and a signed-out request to /admin redirects to /login.
4. For a failed release, restore the previously verified application revision, restart the application and repeat these checks. Review database compatibility before reverting changes to the schema.

The GitHub workflow verifies changes. Staging deployments are manual. The planned Santa María offline replica is a later environment.

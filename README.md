# GE E-Learning

Spanish-first professional training marketplace for Equatorial Guinea. The staging application is available at https://edu.senosl.com.

## Architecture

A single Node.js HTTP process serves server-rendered Spanish HTML, the student catalog and player, instructor and institution access, and the protected administrator tools. Nginx terminates HTTPS and forwards requests to the loopback listener. The mobile interface uses a shared stylesheet without client-side JavaScript.

SQLite stores course drafts separately from student identities, memberships, sessions, enrollments and progress. Institution access is checked server-side against the signed-in user's memberships. Platform administrator credentials use a separate server-side file. Restarting the process expires in-memory administrator sessions.

## Development

Use Node.js 22.13 or later with the built-in SQLite module, Git and Python 3. From the repository root, start an isolated local instance with the following commands in one shell.

```sh
ge_dev_dir=$(mktemp -d)
export GE_COURSE_DIR="$ge_dev_dir/data"
export GE_ADMIN_CREDENTIAL_FILE="$ge_dev_dir/administrator.json"
export PORT=4188
node scripts/create-admin.js
npm start
```

The public catalog and health endpoint are available on the local port. Browser sign-in uses the staging HTTPS origin and secure cookies. Use the isolated HTTP integration tests for local authenticated flows.

## Verification

Run `npm run check` in a Git checkout. It syntax-checks all tracked JavaScript modules and runs the Python HTTP integration suite. Tests launch a separate app on an ephemeral port, create temporary databases and synthetic credentials, and remove them after the run. The account tests cover sign-in, profile isolation, role assignment and revocation, and cross-institution reads and writes. New regression tests belong in `tests/test_*.py`.

GitHub Actions runs this same command on pull requests and pushes to main. After deployment, check the public health endpoint, catalog, and protected-route redirects against the running staging instance. See [staging operations](deploy/README.md).

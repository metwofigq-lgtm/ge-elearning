"""HTTP regression test for existing student accounts, roles and tenant boundaries."""
import hashlib
import http.client
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import unittest
from urllib.parse import urlencode


class AccountsTest(unittest.TestCase):
    def test_isolation(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory, socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            port = probe.getsockname()[1]
            probe.close()
            credentials = Path(directory) / 'account'
            credentials.write_text(json.dumps(dict(username='administrator', salt='00',
                hash=hashlib.scrypt(b'test-admin', salt=bytes(1), n=16384, r=8, p=1).hex())))
            server = subprocess.Popen(['node', 'server.js'], cwd=root, env=dict(os.environ,
                PORT=str(port), GE_COURSE_DIR=directory, GE_ADMIN_CREDENTIAL_FILE=str(credentials)))
            try:
                def request(path, cookie='', fields=None, status=200):
                    conn = http.client.HTTPConnection('127.0.0.1', port, timeout=3)
                    conn.request('GET' if fields is None else 'POST', path, urlencode(fields or {}),
                        {'Origin':'https://edu.senosl.com', 'Cookie':cookie,
                         'Content-Type':'application/x-www-form-urlencoded'})
                    response = conn.getresponse()
                    body = response.read().decode()
                    conn.close()
                    self.assertEqual(response.status, status, path)
                    return body, (response.getheader('Set-Cookie') or '').split(';')[0]

                for _ in range(80):
                    try:
                        request('/health')
                        break
                    except ConnectionRefusedError:
                        time.sleep(.05)
                admin = request('/login', fields=dict(username='administrator', password='test-admin'), status=303)[1]
                def register(name):
                    return request('/espacios/estudiante/registro', fields=dict(usuario=name, clave='sample-password-22'), status=303)[1]
                alice, bob = register('alice'), register('bob')
                request('/admin/cuentas', alice, status=302)
                request('/cuenta/instructor', alice, status=403)
                request('/cuenta', alice, dict(accion='perfil', nombre='Alicia'), 303)
                self.assertIn('Alicia', request('/cuenta', alice)[0])
                self.assertNotIn('Alicia', request('/cuenta', bob)[0])
                def manage(**data):
                    request('/admin/cuentas', admin, data, 303)
                for name in ['Escuela A', 'Escuela B']:
                    manage(accion='institucion', nombre=name)
                for name, org, role in [('alice','1','director'),('alice','1','docente'),
                                        ('alice','2','docente'),('bob','2','director'),('alice','','instructor')]:
                    manage(accion='conceder', usuario=name, institucion=org, rol=role)
                request('/cuenta/instructor', alice)
                request('/cuenta/instructor', bob, status=403)
                tenant = '/cuenta/instituciones/'
                edit = dict(accion='descripcion', descripcion='Private A')
                request(tenant+'1', alice, edit, 303)
                self.assertIn('Private A', request(tenant+'1', alice)[0])
                request(tenant+'1', bob, status=403)
                request(tenant+'1', bob, edit, 403)
                request(tenant+'2', alice, edit, 403)
                self.assertNotIn('Private A', request(tenant+'2', bob)[0])
                self.assertNotIn('Escuela A', request('/cuenta', bob)[0])
                manage(accion='retirar', usuario='alice', institucion='1', rol='director')
                request(tenant+'1', alice, edit, 403)
                request(tenant+'1', alice)
                manage(accion='retirar', usuario='alice', institucion='', rol='instructor')
                request('/cuenta/instructor', alice, status=403)
            finally:
                server.terminate()
                server.wait()


if __name__ == '__main__':
    unittest.main()

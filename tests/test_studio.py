"""Exercise the same HTTP routes used by instructor and admin browsers."""
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import socket
import sqlite3
import subprocess
import tempfile
import time
import unittest
from urllib.parse import urlencode
from html import unescape


class StudioTest(unittest.TestCase):
    def test_authoring(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as d:
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                port = sock.getsockname()[1]
            cred = Path(d)/'admin.json'
            cred.write_text(json.dumps(dict(username='qa', salt='00', hash=hashlib.scrypt(
                b'qa', salt=bytes(1), n=16384, r=8, p=1).hex())))
            app = subprocess.Popen(['node','server.js'], cwd=root, env=dict(os.environ,PORT=str(port),
                GE_ADMIN_CREDENTIAL_FILE=str(cred), GE_COURSE_DIR=d))
            try:
                def req(path, cookie='', data=None, status=200):
                    conn=http.client.HTTPConnection('127.0.0.1',port)
                    body=data if isinstance(data,bytes) else urlencode(data or {})
                    conn.request('GET' if data is None else 'POST',path,body,{'Cookie':cookie,
                        'Origin':'https://edu.senosl.com','Content-Type':'application/x-www-form-urlencoded'})
                    r=conn.getresponse()
                    result=r.read()
                    conn.close()
                    self.assertEqual(r.status,status,(path,result[:180]))
                    return r,result
                for _ in range(100):
                    try:
                        req('/health')
                        break
                    except ConnectionRefusedError:
                        time.sleep(.04)
                def login(path,fields):
                    return req(path,data=fields,status=303)[0].getheader('Set-Cookie').split(';')[0]
                admin=login('/login',dict(username='qa',password='qa'))
                base='/cuenta/instructor/estudio'
                auth=[]
                for name in ['autor','otro']:
                    auth.append(login('/espacios/estudiante/registro',dict(usuario=name,clave='test-pass-123456')))
                    req('/admin/cuentas',admin,dict(accion='conceder',usuario=name,rol='instructor',institucion=''),303)
                a,b=auth
                path=req(base,a,dict(action='create',title='Curso QA'),303)[0].getheader('Location')
                req(path,b,status=404)
                def revision():
                    return re.search(rb'name="revision" value="(\d+)"',req(path,a)[1]).group(1).decode()
                def edit(action,**fields):
                    req(path,a,dict(action=action,revision=revision(),**fields),303)
                def modules():
                    with sqlite3.connect(Path(d)/'courses.sqlite') as cx:
                        return json.loads(cx.execute('SELECT modules FROM studio').fetchone()[0])
                edit('details',title='Curso QA',outline='Programa',category='Tecnología',price='2500')
                edit('module-add',title='Uno')
                edit('module-add',title='Dos')
                m=modules()[1]['id']
                edit('module-move',module=m,step='-1')
                self.assertEqual(modules()[0]['id'],m)
                edit('module-edit',module=m,title='Dos editado')
                for module in modules():
                    edit('lesson-add',module=module['id'],title='Lección',body='Texto de prueba')
                edit('lesson-add',module=m,title='Segunda',body='Texto')
                lid=modules()[0]['lessons'][1]['id']
                edit('lesson-move',module=m,lesson=lid,step='-1')
                edit('lesson-edit',module=m,lesson=lid,title='Introducción',body='Texto actualizado')
                edit('quiz',module=m,lesson=lid,prompt='Pregunta',opt0='Uno',opt1='Dos',opt2='Tres',correct='1')
                for kind,payload in [('pdf',b'%PDF-1.4\n' + bytes(530000)),('video',(root/'media/incidencia.mp4').read_bytes())]:
                    upload=json.loads(req(path+'/subir/'+lid+'/'+kind,a,dict(size=len(payload),revision=revision()))[1])['url']
                    for offset in range(0,len(payload),524288):
                        req(upload+'/'+str(offset),a,payload[offset:offset+524288],204)
                view=req(path+'/vista?r_'+lid+'=1',a)[1].decode()
                self.assertIn('Respuesta correcta.',view)
                for link in re.findall(r'(?:href|src)="([^"]+/media/[^"]+)"',view):
                    req(unescape(link),a)
                    req(unescape(link),b,status=404)
                edit('submit')
                self.assertIn(b'En revisi',req(path,a)[1])
                req(path,a,dict(revision=revision(),action='module-add',title='X'),409)
                edit('withdraw')
                req(path,a,dict(revision=0,action='module-add',title='Viejo'),409)
                self.assertNotIn(b'Curso QA',req('/espacios/estudiante/catalogo')[1])
                self.assertIn(b'Curso QA',req('/admin/estudio',admin)[1])
                legacy=req('/admin/cursos/nuevo',admin,dict(title='A+ QA',outline='Programa original'),303)[0].getheader('Location').split('?')[0]
                old_id=legacy.rsplit('/',1)[1]
                self.assertIn(b'Organizar m',req(legacy,admin)[1])
                old_studio='/admin/estudio/'+old_id
                self.assertIn(b'Programa original',req(old_studio,admin)[1])
                req(base+'/'+old_id,a,status=404)
                req(old_studio,admin,dict(action='assign',revision='1',usuario='autor'),303)
                self.assertIn(b'Programa original',req(base+'/'+old_id,a)[1])
            finally:
                app.terminate()
                app.wait()


if __name__=='__main__':
    unittest.main()

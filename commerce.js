import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { db, identity } from './student.js';
import { db as courses, escape } from './courses.js';
import { layout } from './layout.js';

db.exec(`CREATE TABLE IF NOT EXISTS sale_terms(series INTEGER PRIMARY KEY, instructor_pct INTEGER NOT NULL CHECK(instructor_pct BETWEEN 0 AND 100));
CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, student INTEGER NOT NULL REFERENCES students, course TEXT NOT NULL,series INTEGER NOT NULL,
 title TEXT NOT NULL, owner INTEGER NOT NULL, gross INTEGER NOT NULL, pct INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
 released INTEGER NOT NULL DEFAULT 0,reference TEXT UNIQUE,created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX IF NOT EXISTS open_order ON orders(student,series) WHERE state IN ('pending','paid');
CREATE TABLE IF NOT EXISTS payouts(id TEXT PRIMARY KEY,owner INTEGER NOT NULL,amount INTEGER NOT NULL,state TEXT NOT NULL DEFAULT 'requested',reference TEXT UNIQUE);
CREATE TABLE IF NOT EXISTS ledger(id INTEGER PRIMARY KEY, event TEXT NOT NULL, source TEXT NOT NULL, owner INTEGER NOT NULL,
 gross INTEGER NOT NULL, instructor INTEGER NOT NULL,platform INTEGER NOT NULL,tax INTEGER NOT NULL,fee INTEGER NOT NULL,
 disbursed INTEGER NOT NULL,reference TEXT NOT NULL,created TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(event,source));
CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON ledger BEGIN SELECT RAISE(ABORT,'immutable'); END;
CREATE TRIGGER IF NOT EXISTS ledger_no_delete BEFORE DELETE ON ledger BEGIN SELECT RAISE(ABORT,'immutable'); END;`);

const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
function integer(value,max){if(value===null||!/^\d+$/.test(String(value))||!Number.isSafeInteger(Number(value))||Number(value)>max)fail(422,'Importe no válido.');return Number(value);}
function reference(value){const text=String(value||'').trim();if(!text||text.length>120)fail(422,'Introduce una referencia de operación.');return text;}
function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(err){db.exec('ROLLBACK');throw err;}}
function balance(owner){
 const cleared=db.prepare(`SELECT COALESCE(SUM(l.instructor),0) AS n FROM ledger l JOIN orders o ON o.id=l.source WHERE o.owner=? AND o.released=1`).get(owner).n;
 const reserved=db.prepare("SELECT COALESCE(SUM(amount),0) AS n FROM payouts WHERE owner=? AND state IN ('requested','paid')").get(owner).n;
 return cleared-reserved;
}
function post(event,source,owner,gross,instructor,platform,tax,fee,disbursed,ref){
 db.prepare('INSERT INTO ledger(event,source,owner,gross,instructor,platform,tax,fee,disbursed,reference) VALUES(?,?,?,?,?,?,?,?,?,?)')
 .run(event,source,owner,gross,instructor,platform,tax,fee,disbursed,ref);
}
function createOrder(student,course){
 const match=/^curso-(\d+)-v(\d+)$/.exec(course);
 if(!match)fail(404,'Curso no encontrado.');
 const existing=db.prepare("SELECT * FROM orders WHERE student=? AND series=? AND state IN ('pending','paid')").get(student,match[1]);
 if(existing)return existing.id;
 const release=courses.prepare('SELECT * FROM releases WHERE course=? ORDER BY version DESC LIMIT 1').get(match[1]);
 if(!release||release.version!==Number(match[2])||release.price<=0)fail(409,'Vuelve al catálogo para consultar el precio actual.');
 if(db.prepare("SELECT 1 FROM enrollment WHERE student=? AND course LIKE ?").get(student,'curso-'+release.course+'-v%'))fail(409,'Ya tienes acceso a este curso.');
 const snapshot=JSON.parse(release.snapshot),oid=randomUUID();
 const pct=db.prepare('SELECT instructor_pct FROM sale_terms WHERE series=?').get(release.course)?.instructor_pct??70;
 db.prepare('INSERT INTO orders(id,student,course,series,title,owner,gross,pct) VALUES(?,?,?,?,?,?,?,?)').run(oid,student,course,release.course,snapshot.title,snapshot.owner,release.price,pct);
 return oid;
}
function capture(order,fields){
 const ref=reference(fields.get('reference')),amount=integer(fields.get('amount'),100000000);
 const tax=integer(fields.get('tax')??'0',amount),fee=integer(fields.get('fee')??'0',amount);
 if(amount!==order.gross||tax+fee>amount)fail(422,'Comprueba el importe, los impuestos y la comisión de cobro.');
 if(order.state!=='pending'){
  const prior=db.prepare("SELECT * FROM ledger WHERE event='sale' AND source=?").get(order.id);
  if(prior&&prior.reference===ref&&prior.tax===tax&&prior.fee===fee)return;
  fail(409,'El pedido ya se ha procesado.');
 }
 if(db.prepare('SELECT 1 FROM orders WHERE reference=?').get(ref))fail(409,'Referencia ya utilizada.');
 if(db.prepare('SELECT 1 FROM enrollment WHERE student=? AND course LIKE ?').get(order.student,'curso-'+order.series+'-v%'))fail(409,'Ya existe una matrícula para este curso.');
 const net=amount-tax-fee,share=Math.floor(amount*order.pct/100);
 db.prepare("UPDATE orders SET state='paid',reference=? WHERE id=?").run(ref,order.id);
 post('sale',order.id,order.owner,amount,share,net-share,tax,fee,0,ref);
 db.prepare('INSERT OR IGNORE INTO enrollment VALUES(?,?)').run(order.student,order.course);
}
function refund(order,fields){
 const ref=reference(fields.get('reference'));
 const sale=db.prepare("SELECT * FROM ledger WHERE event='sale' AND source=?").get(order.id);
 if(!sale)fail(409,'Se requiere un pedido cobrado.');
 const recovered=integer(fields.get('fee')??'0',sale.fee);
 if(order.state==='refunded'&&db.prepare("SELECT 1 FROM ledger WHERE event='refund' AND source=? AND reference=? AND fee=?").get(order.id,ref,-recovered))return;
 if(order.state!=='paid')fail(409,'Se requiere un pedido cobrado.');
 if(db.prepare("SELECT 1 FROM ledger WHERE event='refund' AND reference=?").get(ref))fail(409,'Referencia ya utilizada.');
 post('refund',order.id,order.owner,-sale.gross,-sale.instructor,-sale.platform-(sale.fee-recovered),-sale.tax,-recovered,0,ref);
 db.prepare("UPDATE orders SET state='refunded' WHERE id=?").run(order.id);
 db.prepare('DELETE FROM completion WHERE student=? AND course=?').run(order.student,order.course);
 db.prepare('DELETE FROM enrollment WHERE student=? AND course=?').run(order.student,order.course);
}
const hidden=(key,val)=>`<input type="hidden" name="${key}" value="${escape(val)}">`;
const form=(action,id,fields,label)=>`<form method="post">${hidden('action',action)}${hidden('id',id)}${fields}<button>${label}</button></form>`;
const number=(name,label,value='0')=>`<label>${label}<input type="number" name="${name}" min="0" value="${value}" required></label>`;
const refField='<label>Referencia del justificante<input name="reference" maxlength="120" required></label>';
const states={pending:'Pendiente de pago',paid:'Pagado',refunded:'Reembolsado',cancelled:'Cancelado',requested:'Solicitado',declined:'Denegado'};
async function read(req){
 const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>8192)fail(413,'Solicitud demasiado grande.');chunks.push(chunk);}
 return Buffer.concat(chunks);
}
export async function commerce(req,res,path,send){
 const admin=path==='/admin/ventas',earnings=path==='/cuenta/ingresos',hook=path==='/pagos/confirmacion';
 const user=identity(req).id;
 if(!admin&&!hook&&!user)return send(res,303,'','text/plain',{Location:'/espacios/estudiante/acceso'});
 if(earnings&&!db.prepare('SELECT 1 FROM instructors WHERE user_id=?').get(user))fail(403,'Acceso denegado.');
 const postRequest=req.method==='POST';
 if(hook&&!postRequest)fail(405,'Método no permitido.');
 if(!postRequest&&req.method!=='GET')fail(405,'Método no permitido.');
 if(postRequest){
  const raw=await read(req),f=new URLSearchParams(raw.toString());
  if(hook){
   const key=process.env.GE_PAYMENT_WEBHOOK_SECRET;
   if(!key||key.length<32)fail(503,'Integración no configurada.');
   const signature=String(req.headers['x-ge-signature']||'');
   const expected=createHmac('sha256',key).update(raw).digest('hex');
   if(!/^[a-f0-9]{64}$/.test(signature)||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))fail(403,'Firma no válida.');
   if(f.get('currency')!=='XAF')fail(422,'Divisa no válida.');
  }
  transaction(()=>{
   const action=hook?'capture':f.get('action'),id=f.get('id');
   if(!admin&&!hook&&action==='order'&&!earnings){createOrder(user,f.get('course'));return;}
   if(earnings&&action==='request'){
    const key=reference(id),prior=db.prepare('SELECT * FROM payouts WHERE id=?').get(key);
    if(prior){if(prior.owner===user&&prior.amount===Number(f.get('amount')))return;fail(409,'Solicitud ya utilizada.');}
    if(!/^[a-f0-9-]{36}$/.test(key))fail(422,'Solicitud no válida.');
    const amount=integer(f.get('amount'),balance(user));
    if(!amount)fail(422,'Saldo insuficiente.');
    db.prepare("INSERT INTO payouts(id,owner,amount) VALUES(?,?,?)").run(key,user,amount);return;
   }
   if(admin&&action==='terms'){
    const series=integer(f.get('series'),2147483647),pct=integer(f.get('pct'),100);
    if(!courses.prepare('SELECT id FROM courses WHERE id=?').get(series))fail(404,'Curso no encontrado.');
    db.prepare('INSERT INTO sale_terms VALUES(?,?) ON CONFLICT(series) DO UPDATE SET instructor_pct=excluded.instructor_pct').run(series,pct);return;
   }
   if(admin&&['disburse','decline'].includes(action)){
    const p=db.prepare('SELECT * FROM payouts WHERE id=?').get(id);
    if(!p)fail(404,'Solicitud no encontrada.');
    if(action==='decline'){db.prepare("UPDATE payouts SET state='declined' WHERE id=? AND state='requested'").run(id);return;}
    const ref=reference(f.get('reference'));
    if(p.state==='paid'&&p.reference===ref)return;
    if(p.state!=='requested'||balance(p.owner)<0)fail(409,'Revisa la solicitud y el saldo disponible.');
    if(db.prepare('SELECT 1 FROM payouts WHERE reference=?').get(ref))fail(409,'Referencia ya utilizada.');
    db.prepare("UPDATE payouts SET state='paid',reference=? WHERE id=?").run(ref,id);
    post('payout',id,p.owner,0,0,0,0,0,p.amount,ref);return;
   }
   const order=db.prepare('SELECT * FROM orders WHERE id=?').get(id);
   if(!order||(!admin&&!hook&&order.student!==user))fail(404,'Pedido no encontrado.');
   if((admin||hook)&&action==='capture'){capture(order,f);return;}
   if(admin&&action==='refund'){refund(order,f);return;}
   if(admin&&action==='release'&&order.state==='paid'){db.prepare('UPDATE orders SET released=1 WHERE id=?').run(id);return;}
   if(!hook&&action==='cancel'&&order.state==='pending'){db.prepare("UPDATE orders SET state='cancelled' WHERE id=?").run(id);return;}
   fail(403,'Acción no disponible.');
  });
  if(hook)return send(res,200,'OK','text/plain');
  return send(res,303,'','text/plain',{Location:path});
 }
 const orders=admin?db.prepare('SELECT * FROM orders ORDER BY rowid DESC').all():db.prepare('SELECT * FROM orders WHERE '+(earnings?'owner':'student')+'=? ORDER BY rowid DESC').all(user);
 const cards=orders.map(o=>{
  let actions='';
  if(!earnings&&o.state==='pending'){
   if(admin)actions+=form('capture',o.id,number('amount','Total recibido (XAF)',o.gross)+number('tax','Impuesto incluido (XAF)')+number('fee','Coste de cobro (XAF)')+refField,'Confirmar cobro de prueba');
   actions+=form('cancel',o.id,'','Cancelar pedido');
  }
  if(admin&&o.state==='paid'){
   if(!o.released)actions+=form('release',o.id,'<p>Confirma que se cumple el plazo de devolución y liquidación acordado.</p>','Liberar saldo');
   actions+=form('refund',o.id,refField+number('fee','Coste de cobro devuelto (XAF)'),'Registrar reembolso total');
  }
  if(!admin&&!earnings&&o.state==='paid')actions+=`<a href="/espacios/estudiante/catalogo/${o.course}">Abrir curso</a>`;
  return `<section><h2>${escape(o.title)}</h2><p>${states[o.state]} · ${o.gross} XAF</p><small>Pedido ${o.id}</small>${actions}</section>`;
 }).join('');
 const title=admin?'Ventas y liquidaciones':earnings?'Mis ingresos':'Mis pedidos';
 let panel='';
 if(admin||earnings){
  const moves=admin?db.prepare('SELECT * FROM ledger ORDER BY id DESC').all():db.prepare('SELECT * FROM ledger WHERE owner=? ORDER BY id DESC').all(user);
  const rows=admin?db.prepare('SELECT * FROM payouts ORDER BY rowid DESC').all():db.prepare('SELECT * FROM payouts WHERE owner=? ORDER BY rowid DESC').all(user);
  if(admin){
   const total=moves.reduce((s,m)=>({gross:s.gross+m.gross,instructor:s.instructor+m.instructor,platform:s.platform+m.platform,tax:s.tax+m.tax,fee:s.fee+m.fee,paid:s.paid+m.disbursed}),{gross:0,instructor:0,platform:0,tax:0,fee:0,paid:0});
   panel+=`<section><h2>Conciliación (XAF)</h2><p>Cobros menos reembolsos: ${total.gross} · Instructores: ${total.instructor} · Plataforma: ${total.platform} · Impuestos: ${total.tax} · Costes: ${total.fee} · Pagado a instructores: ${total.paid}</p></section>`;
   panel+=form('terms','',number('series','ID del curso')+number('pct','Porcentaje del instructor para pedidos futuros',70),'Guardar reparto');
  }else{const available=balance(user);panel+=`<p>Saldo disponible: ${available} XAF</p>`;if(available>0)panel+=form('request',randomUUID(),number('amount','Importe solicitado (XAF)',available),'Solicitar liquidación');}
  panel+='<section><h2>Liquidaciones</h2>'+rows.map(p=>`<p>Instructor #${p.owner} · ${p.amount} XAF · ${states[p.state]} ${escape(p.reference||'')}</p>`+(admin&&p.state==='requested'?form('disburse',p.id,refField,'Aprobar y registrar pago de prueba')+form('decline',p.id,'','Denegar solicitud'):'')).join('')+'</section>';
  panel+='<details><summary>Libro de movimientos</summary>'+moves.map(m=>`<p>${m.created} UTC · ${escape(m.reference)} · Bruto ${m.gross} · Instructor ${m.instructor} · Plataforma ${m.platform} · Impuesto ${m.tax} · Coste ${m.fee} · Liquidado ${m.disbursed} XAF</p>`).join('')+'</details>';
 }
 return send(res,200,layout(title,`<h1>${title}</h1><p>Entorno de prueba · Importes en XAF. Los cobros, reembolsos y liquidaciones se registran por referencia.</p>${panel}${cards||'<p>No hay pedidos.</p>'}`,admin?'/admin':'/espacios/estudiante',admin));
}

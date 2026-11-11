import http from 'node:http';
import {readFileSync} from 'node:fs';
import {randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import {join} from 'node:path';
const port=Number(process.env.PORT||4187),host='127.0.0.1';
const landing=readFileSync(new URL('./web/index.html',import.meta.url));
const login=readFileSync(new URL('./web/login.html',import.meta.url));
const dashboard=readFileSync(new URL('./web/admin.html',import.meta.url));
const credentialFile=process.env.GE_ADMIN_CREDENTIAL_FILE||join(process.env.HOME||'/nonexistent','.config/ge-elearning/admin.json');
const sessions=new Map(),attempts=new Map(),duration=8*60*60*1000;
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; style-src 'unsafe-inline'; script-src 'none'; form-action 'self'; frame-ancestors 'none'"};
function send(res,status,body,type='text/html; charset=utf-8',extra={}){res.writeHead(status,{...headers,'Content-Type':type,...extra});res.end(body);}
function cred(){try{return JSON.parse(readFileSync(credentialFile,'utf8'));}catch{return null;}}
function verify(pass,record){try{const a=scryptSync(pass,Buffer.from(record.salt,'hex'),64),b=Buffer.from(record.hash,'hex');return a.length===b.length&&timingSafeEqual(a,b);}catch{return false;}}
function session(req){const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('ge_session='))?.slice(11);const s=sessions.get(token);if(!s)return null;if(s.expires<Date.now()){sessions.delete(token);return null;}return token;}
function cookie(value,age){return 'ge_session='+value+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age='+age;}
http.createServer(async(req,res)=>{
 const path=new URL(req.url||'/', 'http://localhost').pathname;
 if(req.method==='GET'&&path==='/health')return send(res,200,JSON.stringify({status:'ok',service:'ge-elearning',mode:'staging'}),'application/json');
 if(req.method==='GET'&&path==='/')return send(res,200,landing);
 if(req.method==='GET'&&path==='/admin')return session(req)?send(res,200,dashboard):send(res,302,'','text/plain',{Location:'/login'});
 if(req.method==='GET'&&path==='/login')return session(req)?send(res,302,'','text/plain',{Location:'/admin'}):send(res,200,login);
 if(req.method==='POST'&&(path==='/login'||path==='/logout')){
  if(req.headers.origin!=='https://edu.senosl.com')return send(res,403,'Forbidden','text/plain');
  if(path==='/logout'){const token=session(req);if(token)sessions.delete(token);return send(res,303,'','text/plain',{Location:'/login','Set-Cookie':cookie('',0)});}
  const ip=req.socket.remoteAddress||'unknown',now=Date.now(),state=attempts.get(ip)||{count:0,until:0};
  if(state.until>now)return send(res,429,'Too many attempts','text/plain');
  let body='';try{for await(const chunk of req){body+=chunk;if(body.length>8192)throw Error('large');}}catch{return send(res,413,'Request too large','text/plain');}
  const data=new URLSearchParams(body),record=cred();
  if(!record||data.get('username')!==record.username||!verify(data.get('password')||'',record)){
   state.count++;state.until=state.count>=5?now+15*60*1000:0;attempts.set(ip,state);
   return send(res,303,'','text/plain',{Location:'/login?error=1'});
  }
  attempts.delete(ip);const token=randomBytes(32).toString('hex');sessions.set(token,{expires:now+duration});
  return send(res,303,'','text/plain',{Location:'/admin','Set-Cookie':cookie(token,duration/1000)});
 }
 return send(res,404,'Not found','text/plain');
}).listen(port,host,()=>console.log('GE E-Learning staging listening on '+host+':'+port));

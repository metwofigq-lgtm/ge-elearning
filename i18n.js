import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';

const context=new AsyncLocalStorage();
const dictionaries={};
const languages={es:'Español',en:'English',fr:'Français'};
for(const code of ['en','fr']){
 dictionaries[code]=JSON.parse(readFileSync(new URL('./locales/'+code+'.json',import.meta.url),'utf8'));
}
const keys=Object.keys(dictionaries.en).sort((a,b)=>b.length-a.length);
const quote=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const phrases=new RegExp('(?<![\\p{L}\\p{N}_])(?:'+keys.map(quote).join('|')+')(?![\\p{L}\\p{N}_])','gu');
export function locale(){return context.getStore()?.lang||'es';}
export function t(key){return dictionaries[locale()]?.[key]??key;}
export function preference(req){
 const cookie=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>/^ge_lang=(es|en|fr)$/.test(s));
 if(cookie)return cookie.slice(8);
 const choices=(req.headers['accept-language']||'').split(',').map(part=>{
  const [tag,weight]=part.trim().toLowerCase().split(';');return [tag.split('-')[0],weight?Number(weight.trim().replace(/^q=/,'')):1];
 }).filter(([lang,q])=>Object.hasOwn(languages,lang)&&q>0).sort((a,b)=>b[1]-a[1]);
 return choices[0]?.[0]||'es';
}
export function localizedRequest(handler){
 return (req,res)=>context.run({lang:preference(req),url:req.url},()=>handler(req,res));
}
export function languageMenu(){
 const url=new URL(context.getStore()?.url||'/','https://edu.senosl.com');
 return '<nav class="language-menu" aria-label="'+({es:'Idioma',en:'Language',fr:'Langue'})[locale()]+'">'+Object.entries(languages).map(([code,name])=>
  '<a lang="'+code+'" hreflang="'+code+'" href="/idioma/'+code+'?volver='+encodeURIComponent(url.pathname+url.search)+'"'+(code===locale()?' aria-current="true"':'')+'>'+name+'</a>').join('')+'</nav>';
}
export function switchLanguage(req,res,lang){
 const target=new URL(req.url,'https://edu.senosl.com').searchParams.get('volver')||'/';
 let back='/';
 try{const u=new URL(target,'https://edu.senosl.com');if(u.origin==='https://edu.senosl.com'&&!u.pathname.startsWith('//')&&!u.pathname.startsWith('/idioma/'))back=u.pathname+u.search;}catch{}
 res.writeHead(303,{Location:back,'Cache-Control':'no-store','Set-Cookie':'ge_lang='+lang+'; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax'});res.end();
}
// Dynamic values may coincide with an interface label. Encode before inserting into HTML
// so localization processes only application copy. The browser decodes the original value.
export function escapeData(value){
 const text=String(value);
 if(locale()!=='es'){
  // Protect only matching phrases; keep other text compact, including long lesson bodies.
  const escaped=text.replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  return escaped.replace(phrases,match=>Array.from(match,ch=>'&#'+ch.codePointAt(0)+';').join(''));
 }
 return text.replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function translateText(text){return text.replace(phrases,key=>t(key));}
export function translateResponse(body,type){
 if(locale()==='es')return typeof body==='string'&&type.startsWith('text/plain')?({Forbidden:'Acceso denegado.', 'Not found':'Página no encontrada.', 'Request too large':'Solicitud demasiado grande.', 'Too many attempts':'Demasiados intentos.'}[body]||body):body;
 if(type.startsWith('text/html')){
  return String(body).replace(/<html lang="es">/,'<html lang="'+locale()+'">').split(/(<[^>]*>)/g)
   .map(part=>part.startsWith('<')?part.replace(/(aria-label|placeholder)="([^"]*)"/g,(_,name,value)=>name+'="'+translateText(value)+'"'):translateText(part)).join('');
 }
 if(type.startsWith('text/plain')&&typeof body==='string')return t(body);
 return body;
}

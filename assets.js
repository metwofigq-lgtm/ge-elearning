import { join } from 'node:path';
import { statSync, createReadStream } from 'node:fs';

export const files=join(process.env.GE_COURSE_DIR||join(process.env.HOME,'.local/share/ge-elearning'),'studio-media');

export function serveAsset(req,res,asset){
 const path=join(files,asset.id),size=statSync(path).size;
 let start=0,end=size-1,status=200;
 const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes','Content-Type':asset.type,'Content-Disposition':asset.type==='application/pdf'?'attachment; filename="leccion.pdf"':'inline'};
 if(req.headers.range){
  const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
  if(match){start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),size-1):end;}
  if(!match||start>end){res.writeHead(416,{'Content-Range':'bytes */'+size});return res.end();}
  headers['Content-Range']=`bytes ${start}-${end}/${size}`;status=206;
 }
 res.writeHead(status,{...headers,'Content-Length':end-start+1});
 const stream=createReadStream(path,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
}

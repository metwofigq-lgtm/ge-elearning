import {randomBytes,scryptSync} from 'node:crypto';
import {mkdirSync,writeFileSync,existsSync,chmodSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
const file=process.env.GE_ADMIN_CREDENTIAL_FILE||join(process.env.HOME,'.config/ge-elearning/admin.json');
if(existsSync(file)){console.error('Admin already configured. Refusing to overwrite.');process.exit(1);}
if(!stdin.isTTY){console.error('Run in an interactive SSH terminal.');process.exit(1);}
const rl=createInterface({input:stdin,output:stdout});
const username=(await rl.question('Admin username: ')).trim();
rl.close();
if(!/^[a-zA-Z0-9._-]{3,40}$/.test(username)){console.error('Username must be 3-40 letters/numbers/._-');process.exit(1);}
stdout.write('Admin password (hidden, minimum 16 characters): ');
const password=await new Promise((resolve,reject)=>{
 let value='';
 stdin.setRawMode(true);stdin.resume();stdin.setEncoding('utf8');
 const onData=ch=>{if(ch==='\r'||ch==='\n'){stdin.off('data',onData);stdin.setRawMode(false);stdin.pause();stdout.write('\n');resolve(value);}
 else if(ch==='\u0003'){stdin.setRawMode(false);stdin.pause();reject(Error('Cancelled'));}
 else if(ch==='\u007f'){value=value.slice(0,-1);}
 else if(ch.length===1&&ch>=' '){value+=ch;}};
 stdin.on('data',onData);
});
if(password.length<16){console.error('Password must contain at least 16 characters.');process.exit(1);}
const salt=randomBytes(16).toString('hex'),hash=scryptSync(password,Buffer.from(salt,'hex'),64).toString('hex');
mkdirSync(dirname(file),{recursive:true,mode:0o700});
writeFileSync(file,JSON.stringify({username,salt,hash})+'\n',{mode:0o600,flag:'wx'});
chmodSync(file,0o600);console.log('Administrator account configured. Password not displayed or committed.');

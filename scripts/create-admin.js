import { randomBytes, scryptSync } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
const file=process.env.GE_ADMIN_CREDENTIAL_FILE||join(process.env.HOME,'.config/ge-elearning/admin.json');
if(existsSync(file)){console.error('Admin already configured. Refusing to overwrite.');process.exit(1);}
if(!stdin.isTTY){console.error('Run in an interactive SSH terminal.');process.exit(1);}
const rl=createInterface({input:stdin,output:stdout});
const username=(await rl.question('Admin username: ')).trim();
const password=await rl.question('Admin password (visible while typing): ');
rl.close();
if(!/^[a-zA-Z0-9._-]{3,40}$/.test(username)||password.length<16){console.error('Username 3-40 letters/numbers/._-; password at least 16 characters.');process.exit(1);}
const salt=randomBytes(16).toString('hex'),hash=scryptSync(password,Buffer.from(salt,'hex'),64).toString('hex');
mkdirSync(dirname(file),{recursive:true,mode:0o700});
writeFileSync(file,JSON.stringify({username,salt,hash})+'\n',{mode:0o600,flag:'wx'});
chmodSync(file,0o600);console.log('Administrator credential configured. No password was printed or committed.');

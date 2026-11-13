import { execFileSync } from 'node:child_process';

// Check every JavaScript module under version control, including setup utilities.
const paths = execFileSync('git', ['ls-files', '-z', '--', '*.js', '*.mjs'], { encoding: 'utf8' });
for (const path of paths.split('\0').filter(Boolean)) {
  execFileSync(process.execPath, ['--check', path], { stdio: 'inherit' });
  console.log('Syntax OK', path);
}

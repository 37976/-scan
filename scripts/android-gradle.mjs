import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = process.cwd();
const task = process.argv[2] || 'assembleDebug';
const localJdk = resolve(root, '.android-tools/jdk21');
const localSdk = resolve(root, '.android-tools/android-sdk');
const env = { ...process.env };

if (existsSync(resolve(localJdk, 'bin/java'))) {
  env.JAVA_HOME = localJdk;
  env.PATH = `${resolve(localJdk, 'bin')}:${env.PATH || ''}`;
}
if (existsSync(localSdk)) {
  env.ANDROID_HOME = localSdk;
  env.ANDROID_SDK_ROOT = localSdk;
}
env.GRADLE_USER_HOME ||= resolve(root, '.gradle-local');

const executable = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const result = spawnSync(executable, [task], {
  cwd: resolve(root, 'android'),
  env,
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);

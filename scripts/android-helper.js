import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const action = process.argv[2] || 'run';

const isWindows = process.platform === 'win32';
const androidDir = path.resolve('android');
const gradlewBtn = isWindows ? 'gradlew.bat' : './gradlew';
const gradlewPath = path.join(androidDir, isWindows ? 'gradlew.bat' : 'gradlew');

// 0. Auto-resolve JAVA_HOME using Android Studio's JBR if system Java is incompatible
let jbrPath = '';
if (isWindows) {
    const defaultWinJbr = 'C:\\Program Files\\Android\\Android Studio\\jbr';
    if (fs.existsSync(defaultWinJbr)) jbrPath = defaultWinJbr;
} else if (process.platform === 'darwin') {
    const defaultMacJbr = '/Applications/Android Studio.app/Contents/jbr/Contents/Home';
    if (fs.existsSync(defaultMacJbr)) jbrPath = defaultMacJbr;
} else if (process.platform === 'linux') {
    const defaultLinuxJbr = '/opt/android-studio/jbr';
    if (fs.existsSync(defaultLinuxJbr)) jbrPath = defaultLinuxJbr;
}

if (jbrPath) {
    console.log(`☕ Menggunakan JDK dari Android Studio: ${jbrPath}`);
    process.env.JAVA_HOME = jbrPath;
}

// 1. Check if Gradle Wrapper exists
if (!fs.existsSync(gradlewPath)) {
    console.error('\n❌ [ERROR] Gradle Wrapper tidak ditemukan!');
    console.error('Langkah Penyelesaian:');
    console.error('1. Buka folder "android" menggunakan Android Studio.');
    console.error('2. Tunggu hingga proses "Gradle Sync" selesai secara otomatis.');
    console.error('3. Android Studio akan men-generate file "gradlew" & "gradlew.bat" di folder tersebut.');
    console.error('4. Setelah selesai, jalankan kembali script ini.\n');
    process.exit(1);
}

// 2. Resolve ADB Path
let adbCmd = 'adb';
try {
    execSync('adb --version', { stdio: 'ignore' });
} catch (e) {
    // ADB is not in system PATH, try default Android SDK paths
    let defaultAdb = '';
    if (isWindows && process.env.LOCALAPPDATA) {
        defaultAdb = path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', 'adb.exe');
    } else if (process.platform === 'darwin' && process.env.HOME) {
        defaultAdb = path.join(process.env.HOME, 'Library', 'Android', 'sdk', 'platform-tools', 'adb');
    } else if (process.platform === 'linux' && process.env.HOME) {
        defaultAdb = path.join(process.env.HOME, 'Android', 'Sdk', 'platform-tools', 'adb');
    }

    if (defaultAdb && fs.existsSync(defaultAdb)) {
        adbCmd = `"${defaultAdb}"`;
    } else {
        console.warn('\n⚠️  [WARNING] Perintah "adb" tidak ditemukan di PATH sistem maupun folder default Android SDK.');
        console.warn('Jika kamu menjalankan "run" atau "install", ini mungkin akan gagal.');
        console.warn('Silakan tambahkan folder platform-tools ke PATH sistem kamu, atau sambungkan HP lewat USB Debugging.\n');
    }
}

// 3. Execute actions
try {
    if (action === 'build') {
        console.log('🏗️  Memulai proses compile (assembleDebug)...');
        runCommand(gradlewBtn, ['assembleDebug'], androidDir);
        console.log('✅ Compile sukses!');
    } else if (action === 'install') {
        console.log('📲 Memasang aplikasi ke perangkat (installDebug)...');
        runCommand(gradlewBtn, ['installDebug'], androidDir);
        console.log('✅ Pemasangan sukses!');
    } else if (action === 'run') {
        console.log('🚀 Memulai proses build & install...');
        runCommand(gradlewBtn, ['installDebug'], androidDir);
        
        console.log('📱 Menjalankan aplikasi di perangkat menggunakan ADB...');
        // Execute ADB command to start activity
        const adbArgs = ['shell', 'am', 'start', '-n', 'com.ronnbot.radio/com.ronnbot.radio.MainActivity'];
        
        // Split command if adbCmd has quotes (like full path)
        let execCmd = adbCmd;
        let finalArgs = [...adbArgs];
        if (adbCmd.startsWith('"') && adbCmd.endsWith('"')) {
            execCmd = adbCmd.slice(1, -1);
        }
        
        const adbResult = spawnSync(execCmd, finalArgs, { stdio: 'inherit', shell: true });
        if (adbResult.status !== 0) {
            throw new Error(`Gagal menjalankan aplikasi via ADB (Exit code: ${adbResult.status})`);
        }
        console.log('🎉 Aplikasi berhasil dijalankan di Android-mu!');
    } else {
        console.error(`❌ Action "${action}" tidak dikenal. Gunakan: build, install, atau run.`);
        process.exit(1);
    }
} catch (error) {
    console.error(`\n❌ [ERROR] Proses gagal: ${error.message}\n`);
    process.exit(1);
}

function runCommand(command, args, cwd) {
    const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: true });
    if (result.status !== 0) {
        throw new Error(`Command "${command} ${args.join(' ')}" gagal dengan exit code ${result.status}`);
    }
}

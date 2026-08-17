// deploy.js
import Client from 'ssh2-sftp-client';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig();

const config = {
    host: process.env.SFTP_HOST || process.env.RADIO_HOST || 'ap1.nzb.zelpstore.id',
    port: parseInt(process.env.SFTP_PORT || '2022'),
    username: process.env.SFTP_USERNAME || '',
    password: process.env.SFTP_PASSWORD || ''
};

// Daftar file/folder yang dilarang ikut ke server
const ignoreList = [
    'node_modules',
    'storage',
    '.git',
    '.vscode',
    'package-lock.json',
    'deploy.js',
    'pull.js',
    'AGENTS.md',
    'CLAUDE.md',
    'memory',
    'scratch',
    'hf-backend',
    'test_hoax.js',
    'test_nvidia.js',
    'test_routing.js',
    'upload-retry.js',
    '.env',
    '.next'
];

function runGitCommand(command) {
    try {
        return execSync(command, { encoding: 'utf8' }).trim();
    } catch (err) {
        return null;
    }
}

// Fungsi rekursif untuk membaca SEMUA file lokal (dipakai saat Full Sync)
async function getAllFiles(dir, fileList = []) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        if (ignoreList.includes(file)) continue;
        const name = path.join(dir, file);
        if (fs.statSync(name).isDirectory()) {
            await getAllFiles(name, fileList);
        } else {
            fileList.push(name);
        }
    }
    return fileList;
}

// Membaca file build dashboard
async function getDashboardOutFiles(dir = 'dashboard/out', fileList = []) {
    if (!fs.existsSync(dir)) return fileList;
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const name = path.join(dir, file);
        if (fs.statSync(name).isDirectory()) {
            await getDashboardOutFiles(name, fileList);
        } else {
            fileList.push(name);
        }
    }
    return fileList;
}

async function main() {
    // ─────────────────────────────────────────────
    // 🌟 PARSING FLAGS & CONDITIONAL LOGIC
    // ─────────────────────────────────────────────
    const args = process.argv.slice(2);
    const isFullSync = args.includes('--all');
    const hasGitFlag = args.includes('--git');
    const hasSftpFlag = args.includes('--sftp');

    // Default: Jalan dua-duanya (true)
    let runGit = true;
    let runSftp = true;

    // Jika salah satu atau kedua flag target di-spesifikasikan, gunakan seleksi flag
    if (hasGitFlag || hasSftpFlag) {
        runGit = hasGitFlag;
        runSftp = hasSftpFlag;
    }

    // Cari commit message: ambil argumen pertama yang bukan berawalan '-' (bukan flag)
    const commitMessage = args.find(arg => !arg.startsWith('-'))
        || `deploy: sync auto ${new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '')}`;

    console.log(`\n🔥 RonnBot Pipeline Active Target → Git: ${runGit ? '✅' : '❌'} | SFTP: ${runSftp ? '✅' : '❌'}`);

    // ─────────────────────────────────────────────
    // 📦 TARGET 1: GITHUB VERSION CONTROL SYSTEM
    // ─────────────────────────────────────────────
    if (runGit) {
        console.log('\n💥 [Git] Mode: DELTA COMMIT. Memeriksa status repositori...');
        const status = runGitCommand('git status --porcelain');

        if (!status) {
            console.log('🔄 [Git] Tree clean. Tidak ada perubahan baru untuk di-commit lokal.');
        } else {
            console.log('📦 [Git] Menyetor dan mengunci commit perubahan...');
            runGitCommand('git add .');
            runGitCommand(`git commit -m "${commitMessage}"`);
            console.log(`✅ [Git] Berhasil commit lokal: "${commitMessage}"`);
        }

        console.log('📦 [GitHub] Memulai sinkronisasi repository ke GitHub remote...');
        try {
            console.log('🚀 [GitHub] Meluncurkan perintah git push...');
            execSync('git push', { stdio: 'inherit' });
            console.log('✅ [GitHub] Sempurna! Kode terbaru berhasil dicadangkan ke GitHub.');
        } catch (gitErr) {
            console.error('⚠️ [GitHub] Peringatan: Gagal melakukan push ke GitHub. Tetap melanjutkan pipeline...');
        }
    } else {
        console.log('\n⏩ [GitHub] Dilewati (Flag --git tidak dipanggil).');
    }

    // ─────────────────────────────────────────────
    // 🚀 TARGET 2: SFTP PTERODACTYL SERVER DEPLOYMENT
    // ─────────────────────────────────────────────
    if (runSftp) {
        let filesToUpload = [];

        if (isFullSync) {
            console.log('\n📦 [SFTP] Mode: FULL SYNC (--all) aktif. Memindai seluruh file proyek...');
            filesToUpload = await getAllFiles('.');
        } else {
            console.log('\n🔍 [SFTP] Mode: DELTA SYNC. Mengurai berkas yang berubah dari commit terbaru...');
            const changedFilesRaw = runGitCommand('git diff-tree -r --no-commit-id --name-only HEAD');

            if (changedFilesRaw) {
                filesToUpload = changedFilesRaw.split('\n').filter(file => {
                    if (!file) return false;
                    const parts = file.split(/[/\\]/);
                    const isIgnored = parts.some(part => ignoreList.includes(part));
                    return !isIgnored && fs.existsSync(file);
                });
            }
        }

        // Auto build & include dashboard/out if dashboard source files changed
        const hasDashboardChanges = filesToUpload.some(file => {
            const normalized = file.replace(/\\/g, '/');
            return normalized.startsWith('dashboard/') &&
                !normalized.startsWith('dashboard/out/') &&
                !normalized.startsWith('dashboard/node_modules/');
        });

        if (hasDashboardChanges) {
            // Remove any existing dashboard/out/ files from filesToUpload since they will be rebuilt
            filesToUpload = filesToUpload.filter(file => {
                const normalized = file.replace(/\\/g, '/');
                return !normalized.startsWith('dashboard/out/');
            });

            console.log('\n⚙️ [Dashboard] Perubahan source code dashboard terdeteksi.');
            console.log('⚙️ [Dashboard] Membangun ulang Next.js dashboard secara otomatis (npm run build)...');
            try {
                execSync('npm run build', { cwd: 'dashboard', stdio: 'inherit' });
                console.log('✅ [Dashboard] Build sukses! Memasukkan file "dashboard/out" ke queue upload...');
                const outFiles = await getDashboardOutFiles();
                filesToUpload = [...filesToUpload, ...outFiles];
            } catch (buildErr) {
                console.error('❌ [Dashboard] Gagal melakukan build dashboard:', buildErr.message);
                console.log('⚠️ [Dashboard] Melanjutkan sftp upload tanpa update dashboard.');
            }
        }

        // Auto build & include src/app/dashboard/out if BotOS dashboard source files changed
        const hasBotOSDashboardChanges = filesToUpload.some(file => {
            const normalized = file.replace(/\\/g, '/');
            return normalized.startsWith('src/app/dashboard/') &&
                !normalized.startsWith('src/app/dashboard/out/') &&
                !normalized.startsWith('src/app/dashboard/node_modules/');
        });

        if (hasBotOSDashboardChanges) {
            // Remove any existing src/app/dashboard/out/ files from filesToUpload since they will be rebuilt
            filesToUpload = filesToUpload.filter(file => {
                const normalized = file.replace(/\\/g, '/');
                return !normalized.startsWith('src/app/dashboard/out/');
            });

            console.log('\n⚙️ [BotOS Dashboard] Perubahan source code BotOS dashboard terdeteksi.');
            console.log('⚙️ [BotOS Dashboard] Membangun ulang Next.js BotOS dashboard secara otomatis (npm run build)...');
            try {
                execSync('npm run build', { cwd: 'src/app/dashboard', stdio: 'inherit' });
                console.log('✅ [BotOS Dashboard] Build sukses! Memasukkan file "src/app/dashboard/out" ke queue upload...');
                const outFiles = await getDashboardOutFiles('src/app/dashboard/out');
                filesToUpload = [...filesToUpload, ...outFiles];
            } catch (buildErr) {
                console.error('❌ [BotOS Dashboard] Gagal melakukan build BotOS dashboard:', buildErr.message);
                console.log('⚠️ [BotOS Dashboard] Melanjutkan sftp upload tanpa update BotOS dashboard.');
            }
        }

        // Deduplicate files to upload
        filesToUpload = Array.from(new Set(filesToUpload));

        // Always push .env to Pterodactyl (even if gitignored, critical for env vars)
        if (fs.existsSync('.env') && !filesToUpload.includes('.env')) {
            console.log('🔑 [SFTP] Auto-including .env (environment variables) in upload queue...');
            filesToUpload.push('.env');
        }

        // Always push Google credentials JSON to Pterodactyl if exists
        const googleCreds = 'storage/ronnbot-music-ab8a3df5de8c.json';
        if (fs.existsSync(googleCreds) && !filesToUpload.includes(googleCreds)) {
            console.log('🔑 [SFTP] Auto-including Google Credentials JSON in upload queue...');
            filesToUpload.push(googleCreds);
        }

        if (filesToUpload.length === 0) {
            console.log('👍 [SFTP] Tidak ada file baru/delta yang perlu diunggah. Skip SFTP.');
            // Jangan return di sini, biar bisa lanjut nge-restart Pterodactyl!
        } else {
            const sftp = new Client();
            try {
                console.log(`\n⏳ Menyambungkan ke PTERODACTYL SFTP (Mengirim ${filesToUpload.length} file)...`);
                await sftp.connect(config);
                console.log('✅ Terhubung! Memulai proses sinkronisasi struktur berkas...');

                for (const localFile of filesToUpload) {
                    const remoteFile = '/' + localFile.replace(/\\/g, '/');
                    const remoteDir = path.dirname(remoteFile).replace(/\\/g, '/');

                    if (remoteDir !== '/') {
                        const exists = await sftp.exists(remoteDir);
                        if (!exists) {
                            await sftp.mkdir(remoteDir, true);
                        }
                    }

                    console.log(`🚀 [Pushing] ${localFile} -> ${remoteFile}`);
                    await sftp.put(localFile, remoteFile);
                }

                console.log('\n🎉 [SFTP] Hore! Semua file sukses disinkronisasikan seutuhnya ke Pterodactyl.');
            } catch (err) {
                console.error('\n❌ [SFTP] Proses upload gagal:', err.message);
            } finally {
                await sftp.end();
            }
        } // Penutup blok else (jika filesToUpload > 0)
    } else {
        console.log('⏩ [SFTP] Dilewati (Flag --sftp tidak dipanggil).');
    }

    // ─────────────────────────────────────────────
    // 🔄 RESTART PTERODACTYL SERVER
    // ─────────────────────────────────────────────
    const pteroKey = process.env.PTERO_API_KEY;
    const pteroUrl = process.env.PTERO_URL || 'https://panel.zelpstore.com';
    const pteroId = process.env.PTERO_SERVER_ID || 'dfbf800f';

    async function runDirectWebhookRestart() {
        try {
            const radioPort = process.env.RADIO_PORT || '25637';
            const directHost = config.host;
            const webhookUrl = `http://${directHost}:${radioPort}/api/v2/system/restart`;

            console.log(`⏳ Mengirim request restart langsung ke: ${webhookUrl}`);
            const res = await fetch(webhookUrl, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${pteroKey}`
                }
            });

            if (res.ok) {
                console.log('✅ [Direct Webhook] Server bot berhasil di-restart secara langsung!');
                return true;
            } else {
                const errText = await res.text();
                console.error(`❌ [Direct Webhook] Gagal: HTTP ${res.status} - ${errText}`);
                return false;
            }
        } catch (webhookErr) {
            console.error('❌ [Direct Webhook] Gagal menghubungi port bot langsung:', webhookErr.message);
            return false;
        }
    }

    if (pteroKey && pteroUrl && pteroId) {
        console.log('\n🔄 [Pterodactyl] Mencoba me-restart server secara otomatis...');
        try {
            const url = `${pteroUrl.replace(/\/$/, '')}/api/client/servers/${pteroId}/power`;
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${pteroKey}`
                },
                body: JSON.stringify({ signal: 'restart' })
            });

            if (res.ok) {
                console.log('✅ [Pterodactyl] Server bot berhasil di-restart!');
            } else {
                const text = await res.text();
                console.error(`❌ [Pterodactyl] Gagal me-restart server: HTTP ${res.status}`);
                if (res.status === 403 || text.includes('challenge') || text.includes('Turnstile')) {
                    console.log('⚠️ [Pterodactyl] Cloudflare Turnstile terdeteksi (403). Mencoba alternatif direct webhook...');
                    await runDirectWebhookRestart();
                } else {
                    console.error(`Detail error: ${text.slice(0, 200)}`);
                }
            }
        } catch (err) {
            console.error('❌ [Pterodactyl] Error saat memanggil API Pterodactyl:', err.message);
            console.log('⚠️ [Pterodactyl] Mencoba alternatif direct webhook...');
            await runDirectWebhookRestart();
        }
    } else {
        console.log('\n⏩ [Pterodactyl] Auto-restart dilewati (Set PTERO_API_KEY di .env lokal untuk mengaktifkannya).');
    }

    console.log('\n🎉 [DONE] Tugas pipeline selesai dieksekusi, cuy!');
}

main();
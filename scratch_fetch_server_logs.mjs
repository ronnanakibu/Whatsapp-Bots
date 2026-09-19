import Client from 'ssh2-sftp-client';
import 'dotenv/config';

const config = {
    host: process.env.SFTP_HOST || 'ap1.nzb.zelpstore.id',
    port: parseInt(process.env.SFTP_PORT || '2022'),
    username: process.env.SFTP_USERNAME || '',
    password: process.env.SFTP_PASSWORD || ''
};

async function getConsole() {
    const sftp = new Client();
    try {
        await sftp.connect(config);
        const list = await sftp.list('/storage/logs').catch(() => []);
        console.log('Logs on server:', list.map(f => `${f.name} (${f.size}b)`));

        if (list.some(f => f.name === 'console.log')) {
            const buf = await sftp.get('/storage/logs/console.log');
            console.log('\n--- /storage/logs/console.log ---');
            console.log(buf.toString('utf8'));
        }
    } catch (e) {
        console.error(e.message);
    } finally {
        await sftp.end();
    }
}

getConsole();

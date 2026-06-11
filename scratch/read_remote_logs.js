import Client from 'ssh2-sftp-client';
import { config as dotenvConfig } from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenvConfig();

const config = {
    host: 'ap2.nzb.zelpstore.id',
    port: 2022,
    username: 'ronnlbtrn_11484.dfbf800f',
    password: 'Shbng2007'
};

async function main() {
    const sftp = new Client();
    try {
        console.log('Connecting to remote Pterodactyl SFTP...');
        await sftp.connect(config);
        console.log('Connected! Checking if /storage/logs/app.log exists...');
        const exists = await sftp.exists('/storage/logs/app.log');
        if (!exists) {
            console.error('Remote log file not found at /storage/logs/app.log');
            return;
        }
        
        console.log('Downloading remote app.log...');
        const data = await sftp.get('/storage/logs/app.log');
        const content = data.toString('utf8');
        
        console.log('\n--- REMOTE LOG TAIL (Last 50 Lines) ---');
        const lines = content.split('\n');
        const lastLines = lines.slice(-50);
        console.log(lastLines.join('\n'));
    } catch (err) {
        console.error('Error fetching remote logs:', err.message);
    } finally {
        await sftp.end();
    }
}

main();

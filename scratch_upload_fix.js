import Client from 'ssh2-sftp-client';

const sftp = new Client();
const config = {
    host: 'ap1.nzb.zelpstore.id',
    port: 2022,
    username: 'ronnlbtrn_11484.dfbf800f',
    password: 'HNxzqKvkUDa6#64',
};

async function uploadFix() {
    try {
        await sftp.connect(config);
        console.log('Uploading hfLogsStreamer.js...');
        await sftp.put('./src/services/hfLogsStreamer.js', '/src/services/hfLogsStreamer.js');
        console.log('Done!');
        
        // Restart bot
        const res = await fetch('https://panel.zelpstore.com/api/client/servers/dfbf800f/power', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.PTERO_API_KEY}` // Need API key, let's just trigger webhook
            },
            body: JSON.stringify({ signal: 'restart' })
        });
        
    } catch (err) {
        console.error('Error:', err);
    } finally {
        sftp.end();
    }
}

uploadFix();

import { Readable } from 'stream';

const stream = new Readable({
    read() {}
});

let isReadableEmitted = false;
stream.once('readable', () => {
    isReadableEmitted = true;
});

stream.push('hello ');
stream.push('world');

setTimeout(() => {
    console.log('readable event fired:', isReadableEmitted);
    console.log('Piping (should be "hello world"):');
    stream.pipe(process.stdout);
    stream.push(null);
}, 100);

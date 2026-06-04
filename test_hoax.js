import axios from 'axios';
import * as cheerio from 'cheerio';

async function cekHoax(query) {
    try {
        const { data } = await axios.get(`https://turnbackhoax.id/?s=${encodeURIComponent(query)}`);
        const $ = cheerio.load(data);
        
        const results = [];
        
        $('article').each((i, el) => {
            if (i >= 5) return; // limit to 5
            
            const title = $(el).find('h3 a').text().trim();
            const link = $(el).find('h3 a').attr('href');
            const date = $(el).find('time').text().trim();
            const excerpt = $(el).find('.mh-excerpt p').text().trim();
            
            if (title) {
                results.push({ title, link, date, excerpt });
            }
        });
        
        console.log(JSON.stringify(results, null, 2));
    } catch (err) {
        console.error(err.message);
    }
}

cekHoax(process.argv[2] || 'jokowi');

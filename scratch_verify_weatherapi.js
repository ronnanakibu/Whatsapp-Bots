import dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.WEATHER_API_KEY || 'd3d7ae3ecff7455eb59125400260406';

async function testWeatherAPI() {
    try {
        const q = 'Medan';
        const url = `https://api.weatherapi.com/v1/forecast.json?key=${apiKey}&q=${encodeURIComponent(q)}&days=3&aqi=yes`;
        console.log('Fetching:', url);
        const res = await fetch(url);
        console.log('Status:', res.status, res.statusText);
        const data = await res.json();
        
        console.log('Main keys:', Object.keys(data));
        if (data.location) {
            console.log('location:', data.location);
        }
        if (data.current) {
            console.log('current keys:', Object.keys(data.current));
            console.log('current temp:', data.current.temp_c);
            console.log('current feelslike:', data.current.feelslike_c);
            console.log('current condition:', data.current.condition);
            console.log('current wind:', data.current.wind_kph, data.current.wind_dir);
            console.log('current humidity:', data.current.humidity);
            console.log('current cloud:', data.current.cloud);
            console.log('current pressure:', data.current.pressure_mb);
            console.log('current vis:', data.current.vis_km);
            console.log('current uv:', data.current.uv);
            console.log('current air_quality:', data.current.air_quality);
        }
        if (data.forecast && data.forecast.forecastday) {
            console.log('forecastday length:', data.forecast.forecastday.length);
            const firstDay = data.forecast.forecastday[0];
            console.log('forecast day 1 keys:', Object.keys(firstDay));
            console.log('forecast day 1 day keys:', Object.keys(firstDay.day));
            console.log('forecast day 1 astro keys:', Object.keys(firstDay.astro));
            console.log('forecast day 1 hourly length:', firstDay.hour.length);
            console.log('first hour sample:', firstDay.hour[0]);
        }
    } catch (e) {
        console.error('Error:', e);
    }
}

testWeatherAPI();

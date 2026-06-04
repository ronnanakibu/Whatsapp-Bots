async function run() {
    const res = await fetch("https://multimodalart-cosmos3-nano.hf.space/info");
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
}

run();

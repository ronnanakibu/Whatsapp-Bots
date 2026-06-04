async function run() {
    const res = await fetch('https://integrate.api.nvidia.com/v1/models', {
        headers: {
            'Authorization': 'Bearer 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'
        }
    });
    const data = await res.json();
    console.log(data.data.slice(0, 10).map(m => m.id));
}
run();

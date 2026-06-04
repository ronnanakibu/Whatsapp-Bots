async function run() {
    const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer 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',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'nvidia/llama-3.1-nemotron-70b-instruct',
            messages: [{ role: 'user', content: 'Siapa kamu?' }]
        })
    });
    const data = await res.json();
    console.log(data.choices?.[0]?.message?.content || data);
}
run();

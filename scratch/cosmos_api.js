import { Client } from "@gradio/client";

async function run() {
    try {
        console.log("Connecting to Gradio space...");
        const app = await Client.connect("multimodalart/Cosmos3-Nano");
        console.log("Fetching API info...");
        const apiInfo = await app.view_api();
        console.log(JSON.stringify(apiInfo, null, 2));
    } catch (e) {
        console.error("Error:", e);
    }
}
run();

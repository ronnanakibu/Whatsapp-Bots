import { Client } from "@gradio/client";

async function run() {
    try {
        const app = await Client.connect("multimodalart/Cosmos3-Nano");
        const apiInfo = await app.view_api();
        console.log(JSON.stringify(apiInfo, null, 2));
    } catch (err) {
        console.error(err);
    }
}

run();

// src/commands/utility/summarize.js
// Legacy wrapper: ringkas artikel dari URL via AI (delegated to baca.js)

import bacaCmd from './baca.js'

export default {
    name: 'sumurl',
    aliases: ['summarizeurl'],
    category: 'tools',
    description: 'Ringkas artikel dari URL menggunakan AI',
    usage: '.sumurl [URL]',
    example: '.sumurl https://tekno.kompas.com/artikel-panjang',
    cooldown: 5,
    permissions: ['user'],
    requireBotAdmin: false,
    tags: [
        "sumurl",
        "summarizeurl",
        "ringkas",
        "artikel",
        "web",
        "tools"
    ],
    params: {
        "type": "object",
        "properties": {
            "url": {
                "type": "string",
                "description": "Alamat URL artikel web yang ingin diringkas intisarinya"
            }
        },
        "required": [
            "url"
        ]
    },



    async execute(ctx) {
        return bacaCmd.execute(ctx)
    }
}
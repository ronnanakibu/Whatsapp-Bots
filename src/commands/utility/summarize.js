// src/commands/utility/summarize.js
// Legacy wrapper: ringkas artikel dari URL via AI (delegated to baca.js)

import bacaCmd from './baca.js'

export default {
    name: 'sumurl',
    aliases: ['summarizeurl'],
    category: 'utility',
    description: 'Ringkas artikel dari URL menggunakan AI',
    usage: '.sumurl [URL]',
    example: '.sumurl https://tekno.kompas.com/artikel-panjang',
    cooldown: 5,
    permissions: ['user'],

    async execute(ctx) {
        return bacaCmd.execute(ctx)
    }
}
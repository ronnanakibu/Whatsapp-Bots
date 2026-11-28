// src/core/socketProvider.js
// WhatsAppSocketProvider singleton providing stable indirection to active Baileys socket.
// Prevents scheduler and background closures from clinging to dead sockets across reconnects.

class WhatsAppSocketProvider {
    #currentSocket = null
    #generation = 0
    #listeners = new Set()

    setSocket(sock) {
        this.#currentSocket = sock
        this.#generation++
        for (const listener of this.#listeners) {
            try {
                listener(sock, this.#generation)
            } catch (_) {}
        }
    }

    getCurrent() {
        return this.#currentSocket
    }

    getGeneration() {
        return this.#generation
    }

    clear() {
        this.#currentSocket = null
        for (const listener of this.#listeners) {
            try {
                listener(null, this.#generation)
            } catch (_) {}
        }
    }

    onSocketChange(listener) {
        if (typeof listener !== 'function') return () => {}
        this.#listeners.add(listener)
        return () => this.#listeners.delete(listener)
    }

    getListenerCount() {
        return this.#listeners.size
    }
}

export const socketProvider = new WhatsAppSocketProvider()
export { WhatsAppSocketProvider }
export default socketProvider

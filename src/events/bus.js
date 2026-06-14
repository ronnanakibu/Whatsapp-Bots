import { EventEmitter } from 'events';

class TypedEventBus extends EventEmitter {
  emitEvent(event, payload) {
    return this.emit(event, payload);
  }

  subscribe(event, listener) {
    return this.on(event, listener);
  }

  unsubscribe(event, listener) {
    return this.off(event, listener);
  }
}

export const eventBus = new TypedEventBus();
export default eventBus;

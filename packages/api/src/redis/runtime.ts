import { EventEmitter } from 'node:events';
import Redis from 'ioredis';

/** Redis is optional infrastructure, never an authentication/session store. */
export class RedisRuntime extends EventEmitter {
  readonly client: Redis | null;
  readonly subscriber: Redis | null;
  readonly channel: string;
  subscribed = false;
  private closing = false;

  constructor(
    url: string | undefined,
    readonly namespace = 'cipher',
  ) {
    super();
    this.channel = `${namespace}:presence:v1:transitions`;
    const options = {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      connectTimeout: 500,
      commandTimeout: 150,
      retryStrategy: () => 1000,
    };
    this.client = url ? new Redis(url, options) : null;
    this.subscriber = url ? new Redis(url, options) : null;
    for (const connection of [this.client, this.subscriber]) {
      connection?.on('error', () => this.emit('state'));
      connection?.on('close', () => {
        if (connection === this.subscriber) this.subscribed = false;
        this.emit('state');
      });
    }
    this.client?.on('ready', () => this.emit('state'));
    this.subscriber?.on('ready', () => {
      void this.subscriber!.subscribe(this.channel)
        .then(() => {
          if (this.closing) return;
          this.subscribed = true;
          this.emit('state');
        })
        .catch(() => {
          this.subscribed = false;
          this.emit('state');
        });
    });
    this.subscriber?.on('message', (channel, message) => {
      if (channel === this.channel) this.emit('transition', message);
    });
    void this.client?.connect().catch(() => {});
    void this.subscriber?.connect().catch(() => {});
  }

  get presenceReady() {
    return this.client?.status === 'ready' && this.subscribed;
  }

  async command<T>(work: (client: Redis) => Promise<T>): Promise<T> {
    if (this.client?.status !== 'ready') throw new Error('REDIS_UNAVAILABLE');
    return await work(this.client);
  }

  close() {
    this.closing = true;
    this.subscribed = false;
    this.client?.disconnect();
    this.subscriber?.disconnect();
    this.removeAllListeners();
  }
}

import { EventEmitter } from 'events';
import { logger } from '@librechat/data-schemas';

/**
 * Stubbed KeyvMongo adapter for Backboard storage.
 * Cache operations are no-ops since we don't use MongoDB for caching.
 */
class KeyvMongoStub extends EventEmitter {
  public ttlSupport = false;
  public namespace?: string;

  async get(_key: string): Promise<undefined> {
    return undefined;
  }

  async getMany(keys: string[]): Promise<undefined[]> {
    return keys.map(() => undefined);
  }

  async set(_key: string, _value: string, _ttl?: number): Promise<void> {
    return;
  }

  async delete(_key: string): Promise<boolean> {
    return true;
  }

  async deleteMany(_keys: string[]): Promise<boolean> {
    return true;
  }

  async clear(): Promise<void> {
    return;
  }

  async has(_key: string): Promise<boolean> {
    return false;
  }

  async disconnect(): Promise<boolean> {
    return true;
  }
}

const keyvMongo = new KeyvMongoStub();

keyvMongo.on('error', (err) => logger.error('KeyvMongo stub error:', err));

export default keyvMongo;

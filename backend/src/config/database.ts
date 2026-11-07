import mongoose from 'mongoose';
import { assertE2eStartupReady } from '../services/e2e-runtime-boundary.js';
import { e2eRunEnabled } from '../services/e2e-test-run.js';

export const connectDatabase = async (uri: string): Promise<void> => {
  assertE2eStartupReady();
  if(e2eRunEnabled()&&mongoose.connection.readyState===1)return;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5_000 });
};

export const disconnectDatabase = async (): Promise<void> => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
};

export const getDatabaseState = (): string => {
  const states: Record<number, string> = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };
  return states[mongoose.connection.readyState] ?? 'unknown';
};

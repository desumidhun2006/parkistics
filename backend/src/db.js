const mongoose = require('mongoose');

// Fail fast instead of buffering commands when no DB is attached (serverless cold paths)
mongoose.set('bufferCommands', false);

let mongoMemoryServer = null;

async function connectDB() {
  const customUri = process.env.MONGO_URI || process.env.MONGODB_URI;

  if (customUri) {
    try {
      console.log(`[MongoDB] Connecting to specified URI: ${customUri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@')}`);
      await mongoose.connect(customUri, {
        serverSelectionTimeoutMS: 4000
      });
      console.log('[MongoDB] Connected successfully to provided MONGO_URI.');
      return mongoose.connection;
    } catch (err) {
      console.warn(`[MongoDB] Could not connect to custom URI (${err.message}). Falling back to MongoMemoryServer...`);
    }
  }

  // Attempt local default MongoDB first
  try {
    const localUri = 'mongodb://127.0.0.1:27017/parkistics';
    await mongoose.connect(localUri, {
      serverSelectionTimeoutMS: 1500
    });
    console.log('[MongoDB] Connected to local MongoDB at mongodb://127.0.0.1:27017/parkistics');
    return mongoose.connection;
  } catch (localErr) {
    // Serverless platforms (Vercel etc.) must not download a mongod binary at runtime
    if (process.env.VERCEL) {
      console.log('[MongoDB] Serverless environment detected — running without a database (in-memory app state).');
      throw new Error('no-database-on-serverless');
    }
    // Local mongod is not running; spin up in-memory MongoDB seamlessly
    console.log('[MongoDB] Local mongod daemon not detected. Launching embedded MongoMemoryServer...');
    try {
      const { MongoMemoryServer } = require('mongodb-memory-server');
      mongoMemoryServer = await MongoMemoryServer.create();
      const memUri = mongoMemoryServer.getUri();
      await mongoose.connect(memUri);
      console.log(`[MongoDB] Connected to embedded MongoMemoryServer at ${memUri}`);
      return mongoose.connection;
    } catch (memErr) {
      console.error('[MongoDB] Failed to start MongoMemoryServer:', memErr);
      throw memErr;
    }
  }
}

async function disconnectDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongoMemoryServer) {
    await mongoMemoryServer.stop();
    mongoMemoryServer = null;
  }
  console.log('[MongoDB] Disconnected.');
}

function isDBConnected() {
  return mongoose.connection.readyState === 1;
}

module.exports = {
  connectDB,
  disconnectDB,
  isDBConnected
};

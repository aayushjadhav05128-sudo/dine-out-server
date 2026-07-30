const { MongoMemoryServer } = require('mongodb-memory-server');

async function start() {
  console.log("Starting MongoMemoryServer on port 27017...");
  const mongoServer = await MongoMemoryServer.create({
    instance: {
      port: 27017,
      dbName: 'dineout'
    },
    binary: {
      version: '4.4.29'
    }
  });
  console.log("MongoMemoryServer started on URI:", mongoServer.getUri());
  
  // Keep process alive
  process.on('SIGINT', async () => {
    console.log("Stopping MongoMemoryServer...");
    await mongoServer.stop();
    process.exit(0);
  });
}

start().catch(err => {
  console.error("Error starting MongoMemoryServer:", err);
  process.exit(1);
});

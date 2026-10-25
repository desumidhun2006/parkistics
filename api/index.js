// Vercel serverless entry — re-exports the Express app as a single catch-all function.
// Static frontend assets are served from ../../frontend by the Express static middleware.
const app = require('../backend/src/index.js');
module.exports = app;

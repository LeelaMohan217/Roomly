const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Drizzle emits migrations as .sql files that we import at runtime.
config.resolver.sourceExts.push('sql');

module.exports = config;

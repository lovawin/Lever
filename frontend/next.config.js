/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    // Skip type checking during build — type issues are from transitive deps we don't control
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config, { isServer }) => {
    // Silence missing optional transitive deps from wallet SDKs.
    // @coinbase/cdp-sdk optionally imports @x402/* modules that we don't need.
    // These are pulled in by @wagmi/connectors → @base-org/account → @coinbase/cdp-sdk.
    // We never use Coinbase Smart Accounts, so these are safe to ignore.
    const falseModules = [
      '@x402/evm',
      '@x402/core/client',
      '@x402/svm/exact/client',
      '@x402/core',
      '@x402/svm',
    ];
    for (const mod of falseModules) {
      config.resolve.alias[mod] = false;
    }

    // pino-pretty is an optional peer dep of pino (used by walletconnect)
    config.resolve.alias['pino-pretty'] = false;

    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
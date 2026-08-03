/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // wagmi pulls in @base-org/account which has unresolved peer deps.
  // The baseAccount connector isn't critical for our MVP, but webpack
  // still tries to bundle it. transpilePackages lets Next skip static analysis.
  transpilePackages: [
    "@base-org/account",
    "@coinbase/cdp-sdk",
  ],
};
module.exports = nextConfig;

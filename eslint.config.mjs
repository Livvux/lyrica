import nextConfig from "eslint-config-next";

const eslintConfig = [...nextConfig, { ignores: ["dist/**", "macos/.build/**"] }];

export default eslintConfig;

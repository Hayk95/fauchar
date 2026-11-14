module.exports = {
  apps: [
    {
      name: "fauchar-web",
      cwd: "/home/fauchar",
      script: "node_modules/next/dist/bin/next",
      args: "start -H 127.0.0.1 -p 3018",
      env: {
        NODE_ENV: "production",
        NEXT_PUBLIC_API_URL: "https://fauchar.com",
      },
    },
    {
      name: "fauchar-api",
      cwd: "/home/fauchar",
      script: "server/index.js",
      env: {
        NODE_ENV: "production",
        API_HOST: "127.0.0.1",
        API_PORT: "4018",
        CORS_ORIGIN: "https://fauchar.com",
      },
    },
  ],
};

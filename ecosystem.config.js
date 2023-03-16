module.exports = {
  apps: [
    {
      name: "DJ Pasha",
      script: "./build/index.js",
      watch: ["./build"],
      max_memory_restart: "3G",
      time: true,
      args: ["--appDir=/mnt/shared"],
      log_file: "/mnt/shared/DJPasha.log",
      restart_delay: 5000,
    },
  ],
};

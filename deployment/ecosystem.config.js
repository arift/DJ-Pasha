module.exports = {
  apps: [
    {
      name: "DJ-Pasha_InternetCafe",
      cwd: "DJ-Pasha_InternetCafe",
      script: "build/index.js",
      max_memory_restart: "2G",
      time: true,
      args: ["--appDir=/mnt/external-drive"],
      log_file: "/mnt/external-drive/DJ-Pasha_InternetCafe.log",
      restart_delay: 5000,
    },
    {
      name: "DJ-Pasha_BizsRemoteTTRPG",
      cwd: "DJ-Pasha_BizsRemoteTTRPG",
      script: "build/index.js",
      max_memory_restart: "2G",
      time: true,
      args: ["--appDir=/mnt/external-drive"],
      log_file: "/mnt/external-drive/DJ-Pasha_BizsRemoteTTRPG.log",
      restart_delay: 5000,
    },
  ],
};

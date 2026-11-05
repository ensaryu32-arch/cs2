FROM ghcr.io/balintsoos/cs16-web-server:latest

# Counter-Strike 1.6 Web Dedicated Server (16 Kisilik VS Arenasi)
# Port 27016: Web Client & WebSocket/WebRTC Gateway (Render & MEB Uyumlu)
ENV PORT=27016
EXPOSE 27016

# Standart de_dust2 haritasi ve 16 kisilik tam multiplayer
CMD ["+map", "de_dust2", "+maxplayers", "16", "+mp_startmoney", "800", "+mp_roundtime", "1.75", "+mp_freezetime", "2"]

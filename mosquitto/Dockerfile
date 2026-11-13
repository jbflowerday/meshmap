FROM eclipse-mosquitto:2
COPY mosquitto.conf /mosquitto/config/mosquitto.conf
COPY entrypoint.sh /meshmap-entrypoint.sh
RUN chmod +x /meshmap-entrypoint.sh
ENTRYPOINT ["/meshmap-entrypoint.sh"]
CMD ["/usr/sbin/mosquitto", "-c", "/mosquitto/config/mosquitto.conf"]

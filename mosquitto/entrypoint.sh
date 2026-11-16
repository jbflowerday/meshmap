#!/bin/sh
# Generates the Mosquitto password file and ACL from environment variables,
# then hands off to the stock eclipse-mosquitto entrypoint.
set -e

AUTH_DIR=/mosquitto/auth
mkdir -p "$AUTH_DIR" /mosquitto/config/conf.d
PASSWD="$AUTH_DIR/passwd"
ACL="$AUTH_DIR/acl"
ROOT="${MQTT_ROOT_TOPIC:-msh}"

: "${MQTT_BACKEND_USER:?MQTT_BACKEND_USER must be set}"
: "${MQTT_BACKEND_PASSWORD:?MQTT_BACKEND_PASSWORD must be set}"
: "${MQTT_NODE_USER:?MQTT_NODE_USER must be set}"
: "${MQTT_NODE_PASSWORD:?MQTT_NODE_PASSWORD must be set}"

umask 077
rm -f "$PASSWD"
touch "$PASSWD"
mosquitto_passwd -b "$PASSWD" "$MQTT_BACKEND_USER" "$MQTT_BACKEND_PASSWORD"
mosquitto_passwd -b "$PASSWD" "$MQTT_NODE_USER" "$MQTT_NODE_PASSWORD"

{
  if [ "${MQTT_ALLOW_ANONYMOUS:-false}" = "true" ]; then
    echo "# anonymous clients"
    echo "topic readwrite $ROOT/#"
    echo
  fi
  echo "user $MQTT_BACKEND_USER"
  # write is needed to downlink name requests and traceroutes; otherwise only reads
  echo "topic readwrite $ROOT/#"
  echo
  echo "user $MQTT_NODE_USER"
  echo "topic readwrite $ROOT/#"
} > "$ACL"

if [ "${MQTT_ALLOW_ANONYMOUS:-false}" = "true" ]; then
  echo "allow_anonymous true" > /mosquitto/config/conf.d/auth.conf
else
  echo "allow_anonymous false" > /mosquitto/config/conf.d/auth.conf
fi

chown -R mosquitto:mosquitto "$AUTH_DIR" /mosquitto/data 2>/dev/null || true
chmod 0700 "$AUTH_DIR"
chmod 0600 "$PASSWD" "$ACL"

exec /docker-entrypoint.sh "$@"

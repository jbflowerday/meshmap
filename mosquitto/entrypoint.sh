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

# Node isolation (default on): nodes may publish anywhere under the root but only
# receive what MeshMap itself downlinks (topics ending in MeshMap's node id), so
# gateways never hear each other's uplinks and separate meshes are never bridged.
ISOLATE="${MQTT_NODE_ISOLATION:-true}"
MESHMAP_ID="${MESHMAP_NODE_ID:-${NAME_REQUEST_NODE_ID:-}}"
node_acl() {
  if [ "$ISOLATE" != "true" ]; then
    echo "topic readwrite $ROOT/#"
    return
  fi
  echo "topic write $ROOT/#"
  if [ -n "$MESHMAP_ID" ]; then
    # Roots of any depth up to 4 levels below $ROOT, e.g. msh/ANZ or msh/ANZ/brd1.
    # (The ACL file can't stop a node account publishing on these topics too; real
    # firmware only publishes under its own id, so that needs the node password and intent.)
    for lvl in "+" "+/+" "+/+/+" "+/+/+/+"; do
      echo "topic read $ROOT/$lvl/2/e/+/$MESHMAP_ID"
    done
  fi
}
if [ "$ISOLATE" = "true" ] && [ -z "$MESHMAP_ID" ]; then
  echo "[meshmap] MQTT_NODE_ISOLATION is on but MESHMAP_NODE_ID is empty: nodes can't receive anything," \
    "so name requests and traceroutes won't reach the mesh. Set MESHMAP_NODE_ID to MeshMap's node id." >&2
fi

{
  if [ "${MQTT_ALLOW_ANONYMOUS:-false}" = "true" ]; then
    echo "# anonymous clients"
    node_acl
    echo
  fi
  echo "user $MQTT_BACKEND_USER"
  # write is needed to downlink name requests and traceroutes; otherwise only reads
  echo "topic readwrite $ROOT/#"
  echo
  echo "user $MQTT_NODE_USER"
  node_acl
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
